document.addEventListener("DOMContentLoaded", function () {
  // Global variables
  let childWindow = null;
  const previewSessionId = document.getElementById("preview-session-id").value;
  const appStatusBadge = document.getElementById("app-status-badge");
  const appUrlEl = document.getElementById("app-url");
  const projectPath = document.getElementById("project-path").textContent;
  const refreshBtn = document.getElementById("refreshPreviewBtn");
  let logPollInterval = null;

  // Elements for configuration tab
  const projectTypeEl = document.getElementById("project-type");
  const appPortEl = document.getElementById("app-port");
  const appUrlConfigEl = document.getElementById("app-url-config");
  const mainFilesList = document.getElementById("main-files-list");

  // Patch IA UI elements
  const aiPatchAlert = document.getElementById("ai-patch-alert");
  const aiPatchFile = document.getElementById("ai-patch-file");
  const aiPatchExcerpt = document.getElementById("ai-patch-excerpt");
  // URL correction UI
  const manualUrlGroup = document.getElementById("manual-url-group");
  const manualUrlInput = document.getElementById("manual-url-input");
  const manualUrlApply = document.getElementById("manual-url-apply");

  const launchProgressContainer = document.getElementById(
    "launch-progress-container"
  );
  const launchProgressBar = document.getElementById("launch-progress-bar");
  const launchProgressMessage = document.getElementById(
    "launch-progress-message"
  );

  function updateConfig(status) {
    if (projectTypeEl) projectTypeEl.textContent = status.project_type || "Unknown";
    // extract port from URL
    const url = status.url || "";
    const port = url.split(":").pop();
    if (appPortEl) appPortEl.textContent = port;
    if (appUrlConfigEl) appUrlConfigEl.textContent = url;
    // list main files
    if (mainFilesList) mainFilesList.innerHTML = "";
    fetch(`/list_files?directory=${encodeURIComponent(projectPath)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "success") {
          data.files.forEach((file) => {
            const a = document.createElement("a");
            a.className = "list-group-item list-group-item-action";
            a.textContent = file;
            if (mainFilesList) mainFilesList.appendChild(a);
          });
        } else {
          if (mainFilesList) mainFilesList.innerHTML =
            '<div class="text-center py-3 text-muted">Unable to list files</div>';
        }
      })
      .catch(() => {
        if (mainFilesList) mainFilesList.innerHTML =
          '<div class="text-center py-3 text-muted">Error retrieving files</div>';
      });
  }

  function showLaunchProgress(message, percentage) {
    if (launchProgressContainer && launchProgressBar && launchProgressMessage) {
      launchProgressContainer.style.display = "block";
      launchProgressMessage.textContent = message;
      launchProgressBar.style.width = `${percentage}%`;
      launchProgressBar.setAttribute("aria-valuenow", percentage);
    }
  }

  function hideLaunchProgress() {
    if (launchProgressContainer) {
      launchProgressContainer.style.display = "none";
    }
  }

  // Affichage du patch IA si détecté dans les logs
  function updateLogs(logs) {
    let aiPatch = null;
    for (const log of logs) {
      if (log.level === "AI_PATCH_APPLIED") {
        try {
          aiPatch = JSON.parse(log.message);
        } catch {}
      }
    }
    if (aiPatch) {
      aiPatchAlert.classList.remove("d-none");
      aiPatchFile.textContent = aiPatch.file;
      aiPatchExcerpt.textContent = aiPatch.patch_excerpt;
    } else {
      aiPatchAlert.classList.add("d-none");
    }

    // Check for launch messages in logs to update progress
    const installLog = logs.find(
      (log) => log.includes("npm install") || log.includes("Installing dependencies")
    );
    const startLog = logs.find(
      (log) => log.includes("Starting development server") || log.includes("Application starting")
    );

    if (installLog && !startLog) {
      showLaunchProgress("Installing dependencies (this may take a few minutes)...", 33);
    } else if (startLog) {
      showLaunchProgress("Starting application...", 66);
    }
  }

  // Correction manuelle d'URL si non détectée
  function showManualUrlInput() {
    manualUrlGroup.classList.remove("d-none");
    manualUrlInput.value = "";
    manualUrlInput.focus();
  }
  manualUrlApply.addEventListener("click", function () {
    const url = manualUrlInput.value.trim();
    if (url) {
      appUrlEl.innerHTML = `<a href="${url}" target="_blank" class="text-primary">${url}</a> <small class="text-muted">(Manual URL)</small>`;
      manualUrlGroup.classList.add("d-none");
    }
  });

  // Add beforeunload to stop preview
  window.addEventListener("beforeunload", function () {
    // Toujours envoyer la requête d'arrêt, même si aucun childWindow
    if (previewSessionId) {
      navigator.sendBeacon(
        window.URL_PREVIEW_STOP_ON_EXIT,
        JSON.stringify({ session_id: previewSessionId })
      );
    }
    // Nettoyage global (arrête tous les serveurs preview, comme à l'arrêt du serveur Flask)
    fetch('/preview/stop_all', { method: 'POST' });
  });

  // Navigation hooks to stop preview on link click
  document
    .querySelectorAll('a[href]:not([target="_blank"])')
    .forEach((link) => {
      link.addEventListener("click", function (e) {
        if (this.getAttribute("data-bs-toggle") === "tab") return;
        // Toujours arrêter la preview avant de naviguer
        if (previewSessionId) {
          e.preventDefault();
          fetch(window.URL_PREVIEW_STOP_ON_EXIT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: previewSessionId })
          })
            .then(() => {
              window.location.href = this.href;
            })
            .catch(() => {
              window.location.href = this.href;
            });
        }
      });
    });

  function startApp() {
    showLaunchProgress("Initiating application launch...", 10);
    fetch(window.URL_PREVIEW_START, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: previewSessionId, model: window.MODEL }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "success") {
          function handleUrlOrWait(url) {
            if (url && url !== "null" && url !== "") {
              showLaunchProgress("Application running.", 100);
              appStatusBadge.textContent = "Running";
              appStatusBadge.className = "badge bg-success me-2";
              appUrlEl.innerHTML = `<a href="${url}" target="_blank" class="text-primary">${url}</a> <small class="text-muted">(Click to open in a new tab)</small>`;
              setTimeout(hideLaunchProgress, 2000);
              // Try to open in a new tab as a second step, but handle if blocked
              try {
                setTimeout(() => {
                  childWindow = window.open(url, "_blank");
                  if (!childWindow || childWindow.closed || typeof childWindow.closed === "undefined") {
                    // Popup was blocked
                    console.log("Popup blocked. URL already shown as clickable link.");
                  }
                }, 500);
              } catch (e) {
                console.error("Error opening new window:", e);
              }
            } else {
              // No URL yet, poll status every 2s until available
              showLaunchProgress("Waiting for application URL...", 90);
              let pollCount = 0;
              const maxPolls = 15; // Wait up to 30s
              const pollStatus = () => {
                fetch(window.URL_PREVIEW_STATUS)
                  .then((r) => r.json())
                  .then((s) => {
                    if (s.status === "success" && s.url && s.url !== "null" && s.url !== "") {
                      handleUrlOrWait(s.url);
                    } else if (s.status === "error") {
                      alert(s.message || "Preview failed to start.");
                      hideLaunchProgress();
                    } else if (++pollCount < maxPolls) {
                      setTimeout(pollStatus, 2000);
                    } else {
                      appUrlEl.textContent = "Address not available";
                      showManualUrlInput();
                      hideLaunchProgress();
                    }
                  })
                  .catch(() => {
                    if (++pollCount < maxPolls) setTimeout(pollStatus, 2000);
                    else {
                      appUrlEl.textContent = "Address not available";
                      showManualUrlInput();
                      hideLaunchProgress();
                    }
                  });
              };
              pollStatus();
            }
          }
          handleUrlOrWait(data.url);
          // Start log polling
          logPollInterval = setInterval(() => {
            fetch(window.URL_PREVIEW_STATUS)
              .then((r) => r.json())
              .then((s) => updateLogs(s.logs || []));
          }, 3000);
          // update configuration
          updateConfig(data);
        } else {
          // If the backend returns an error but the preview is actually running, try to check status after a short delay
          setTimeout(() => {
            fetch(window.URL_PREVIEW_STATUS)
              .then((r) => r.json())
              .then((s) => {
                if (s.status === "success" && s.url && s.url !== "null" && s.url !== "") {
                  // The app is running, so continue as if success
                  function handleUrlOrWait(url) {
                    if (url && url !== "null" && url !== "") {
                      showLaunchProgress("Application running.", 100);
                      appStatusBadge.textContent = "Running";
                      appStatusBadge.className = "badge bg-success me-2";
                      appUrlEl.innerHTML = `<a href="${url}" target="_blank" class="text-primary">${url}</a> <small class="text-muted">(Click to open in a new tab)</small>`;
                      setTimeout(hideLaunchProgress, 2000);
                      try {
                        setTimeout(() => {
                          childWindow = window.open(url, "_blank");
                          if (!childWindow || childWindow.closed || typeof childWindow.closed === "undefined") {
                            // Popup was blocked
                            console.log("Popup blocked. URL already shown as clickable link.");
                          }
                        }, 500);
                      } catch (e) {
                        console.error("Error opening new window:", e);
                      }
                    } else {
                      appUrlEl.textContent = "Address not available";
                      showManualUrlInput();
                      hideLaunchProgress();
                    }
                  }
                  handleUrlOrWait(s.url);
                  // Start log polling
                  logPollInterval = setInterval(() => {
                    fetch(window.URL_PREVIEW_STATUS)
                      .then((r) => r.json())
                      .then((s) => updateLogs(s.logs || []));
                  }, 3000);
                  updateConfig(s);
                } else {
                  alert(data.message);
                  hideLaunchProgress();
                }
              })
              .catch(() => {
                alert(data.message);
                hideLaunchProgress();
              });
          }, 2000);
        }
      })
      .catch((e) => {
        alert("Error: " + e);
        hideLaunchProgress(); // Hide on error
      });
  }

  // Ajout de la fonction restartApp pour corriger l'erreur lors de l'itération
  function restartApp() {
    // Arrête le polling des logs si actif
    if (logPollInterval) {
      clearInterval(logPollInterval);
      logPollInterval = null;
    }
    // Réinitialise l'état de l'UI
    appStatusBadge.textContent = "Restarting...";
    appStatusBadge.className = "badge bg-warning me-2";
    appUrlEl.textContent = "Restarting...";
    // Relance l'application
    startApp();
  }

  // Iteration button handler
  const iterateBtn = document.getElementById("iteratePreviewBtn");
  const iterationStatus = document.getElementById("iterationStatus");
  function startIteration() {
    const feedback = document.getElementById("interactionInput").value.trim();
    if (!feedback) {
      alert("Please enter feedback for iteration.");
      return;
    }
    iterateBtn.disabled = true;
    iterationStatus.innerHTML = "<em>Iteration started...</em>";
    const form = new FormData();
    form.append("api_key", window.API_KEY);
    form.append("model", window.MODEL);
    form.append("feedback", feedback);
    form.append("regenerate_code", "off");
    fetch(window.URL_CONTINUE_ITERATION, { method: "POST", body: form })
      .then((res) => res.json())
      .then((data) => {
        if (data.status === "success") {
          pollIteration();
        } else {
          iterationStatus.textContent =
            data.message || "Error starting iteration";
          iterateBtn.disabled = false;
        }
      })
      .catch((err) => {
        iterationStatus.textContent = "Network error: " + err;
        iterateBtn.disabled = false;
      });
  }
  function pollIteration() {
    const interval = setInterval(() => {
      fetch(window.URL_GENERATION_PROGRESS)
        .then((res) => res.json())
        .then((data) => {
          iterationStatus.textContent = `Progress: ${data.progress}% - ${data.current_step}`;
          if (data.status === "completed" || data.status === "failed") {
            clearInterval(interval);
            if (data.status === "completed") {
              iterationStatus.textContent = "Iteration completed.";
              // restart preview to apply changes without changing port
              restartApp();
            } else {
              iterationStatus.textContent =
                "Iteration failed: " + (data.error || "Unknown error");
            }
            iterateBtn.disabled = false;
          }
        })
        .catch((err) => {
          clearInterval(interval);
          iterationStatus.textContent = "Error during polling: " + err;
          iterateBtn.disabled = false;
        });
    }, 2000);
  }
  iterateBtn.addEventListener("click", startIteration);

  // Event Listeners
  refreshBtn.addEventListener("click", () => fetch(window.URL_PREVIEW_REFRESH));

  // Auto-start application on preview load
  if (previewSessionId) {
    startApp();
  }

  // Fonction utilitaire pour forcer le nettoyage global (stop_all)
  function stopAllPreviews() {
    fetch('/preview/stop_all', { method: 'POST' });
  }
  // Appel automatique lors du beforeunload (optionnel, ou à placer sur un bouton admin)
  // window.addEventListener('beforeunload', stopAllPreviews);
  // Désactive la gestion des boutons start/stop/restart car ils n'existent plus
  // (Pas d'ajout d'eventListener sur startAppBtn, stopAppBtn, restartAppBtn, openInNewTabBtn)
});