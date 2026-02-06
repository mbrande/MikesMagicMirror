const NodeHelper = require("node_helper");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const TOKEN_PATH = path.join(__dirname, "ring-token.json");

module.exports = NodeHelper.create({
	ringApi: null,
	cameras: {},
	pollTimer: null,
	lastDingIds: {},
	motionTimeouts: {},
	motionRefreshIntervals: {},
	motionDetectionTypes: {},
	motionOriginalUrls: {},

	start: function () {
		console.log("[MMM-RingSnapshot] Node helper starting...");
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "START" && !this.ringApi) {
			this.config = payload;
			this.initRing();
		}
	},

	initRing: async function () {
		try {
			const { RingApi } = await import("ring-client-api");

			var tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));

			this.ringApi = new RingApi({
				refreshToken: tokenData.refreshToken,
				cameraStatusPollingSeconds: 20,
			});

			// Persist rotated refresh tokens
			this.ringApi.onRefreshTokenUpdated.subscribe({
				next: ({ newRefreshToken }) => {
					console.log("[MMM-RingSnapshot] Refresh token updated, saving...");
					fs.writeFileSync(
						TOKEN_PATH,
						JSON.stringify({ refreshToken: newRefreshToken })
					);
				},
			});

			var allCameras = await this.ringApi.getCameras();
			console.log("[MMM-RingSnapshot] Found " + allCameras.length + " camera(s):");
			allCameras.forEach(function (c) {
				console.log("[MMM-RingSnapshot]   - " + c.name);
			});

			// Match requested cameras by name
			var cameraNames = this.config.cameras || ["Front Door", "Driveway"];
			var self = this;

			cameraNames.forEach(function (name) {
				for (var i = 0; i < allCameras.length; i++) {
					if (allCameras[i].name.toLowerCase().includes(name.toLowerCase())) {
						var key = name;
						self.cameras[key] = allCameras[i];
						self.lastDingIds[key] = null;
						console.log("[MMM-RingSnapshot] Matched camera: " + allCameras[i].name + " -> " + key);

						// Push-based motion detection
						(function (camKey, cam) {
							cam.onMotionStarted.subscribe({
								next: function () {
									console.log("[MMM-RingSnapshot] Motion detected (push): " + camKey);
									self.onMotion(camKey);
								},
							});
							if (cam.isDoorbot) {
								cam.onDoorbellPressed.subscribe({
									next: function () {
										console.log("[MMM-RingSnapshot] Doorbell pressed (push): " + camKey);
										self.onMotion(camKey);
									},
								});
							}
						})(key, allCameras[i]);

						break;
					}
				}
			});

			var foundNames = Object.keys(this.cameras);
			this.sendSocketNotification("CAMERAS_READY", foundNames);

			// Take initial snapshots for all cameras
			for (var k = 0; k < foundNames.length; k++) {
				this.takeSnapshot(foundNames[k]);
			}

			// Start polling for events
			this.pollForEvents();

			// Refresh snapshots periodically (every 5 minutes)
			this.refreshSnapshots();

		} catch (err) {
			console.error("[MMM-RingSnapshot] Init error:", err.message);
		}
	},

	refreshSnapshots: function () {
		var self = this;
		setInterval(function () {
			var names = Object.keys(self.cameras);
			for (var i = 0; i < names.length; i++) {
				self.takeSnapshot(names[i]);
			}
		}, self.config.snapshotInterval || 300000);
	},

	pollForEvents: async function () {
		var names = Object.keys(this.cameras);

		for (var i = 0; i < names.length; i++) {
			var camKey = names[i];
			try {
				var history = await this.cameras[camKey].getEvents({ limit: 1 });
				var events = Array.isArray(history) ? history : (history && history.events ? history.events : []);

				if (events.length > 0) {
					var latest = events[0];
					var eventAge = Date.now() - new Date(latest.created_at).getTime();
					var dingId = latest.event_id || latest.ding_id_str || latest.id || String(latest.ding_id);

					if (dingId !== this.lastDingIds[camKey] && eventAge < 90000) {
						this.lastDingIds[camKey] = dingId;
						console.log("[MMM-RingSnapshot] Motion detected (poll) on " + camKey + ": " + (latest.event_type || latest.kind) + ", age: " + Math.round(eventAge / 1000) + "s");
						this.onMotion(camKey);
					} else if (dingId !== this.lastDingIds[camKey]) {
						this.lastDingIds[camKey] = dingId;
					}
				}
			} catch (err) {
				console.error("[MMM-RingSnapshot] Poll error (" + camKey + "):", err.message);
			}
		}

		var self = this;
		this.pollTimer = setTimeout(function () {
			self.pollForEvents();
		}, this.config.pollInterval || 15000);
	},

	onMotion: async function (camKey) {
		// Take a fresh snapshot
		await this.takeSnapshot(camKey);

		// Run detection if any detection type is enabled
		var detectionEnabled = this.config.personDetection !== false || this.config.vehicleDetection !== false || this.config.animalDetection !== false;
		if (detectionEnabled) {
			var detection = await this.runDetection(camKey);
			var personFound = this.config.personDetection !== false && detection.person;
			var vehicleFound = this.config.vehicleDetection !== false && detection.vehicle;
			var animalFound = this.config.animalDetection !== false && detection.animal;
			if (!personFound && !vehicleFound && !animalFound) {
				console.log("[MMM-RingSnapshot] No person/vehicle/animal detected on " + camKey + ", skipping alert");
				return;
			}

			// Save which object types triggered and preserve the original detection snapshot
			this.motionDetectionTypes[camKey] = { person: personFound, vehicle: vehicleFound, animal: animalFound };
			var snapshotFile = "snapshot-" + camKey.toLowerCase().replace(/\s+/g, "-");
			var currentPath = path.join(__dirname, snapshotFile + ".jpg");
			var originalPath = path.join(__dirname, snapshotFile + "-motion.jpg");
			fs.copyFileSync(currentPath, originalPath);
			this.motionOriginalUrls[camKey] = "/modules/MMM-RingSnapshot/" + snapshotFile + "-motion.jpg?" + Date.now();
			console.log("[MMM-RingSnapshot] Saved original detection snapshot for " + camKey);
		}

		// Notify frontend of motion
		this.sendSocketNotification("MOTION", camKey);

		// Clear previous timeout for this camera
		if (this.motionTimeouts[camKey]) {
			clearTimeout(this.motionTimeouts[camKey]);
		}

		// Clear previous refresh interval for this camera
		if (this.motionRefreshIntervals[camKey]) {
			clearInterval(this.motionRefreshIntervals[camKey]);
		}

		// Refresh snapshots every 5 seconds during motion
		var self = this;
		if (detectionEnabled) {
			// With detection: check if object is still in frame before updating the displayed image
			this.motionRefreshIntervals[camKey] = setInterval(function () {
				self.refreshMotionSnapshot(camKey);
			}, 5000);
		} else {
			// Without detection: simple refresh
			this.motionRefreshIntervals[camKey] = setInterval(function () {
				self.takeSnapshot(camKey);
			}, 5000);
		}

		// Clear motion highlight and stop refresh after duration
		this.motionTimeouts[camKey] = setTimeout(function () {
			if (self.motionRefreshIntervals[camKey]) {
				clearInterval(self.motionRefreshIntervals[camKey]);
				delete self.motionRefreshIntervals[camKey];
			}
			delete self.motionDetectionTypes[camKey];
			delete self.motionOriginalUrls[camKey];
			// Clean up the saved motion snapshot file
			var motionFile = path.join(__dirname, "snapshot-" + camKey.toLowerCase().replace(/\s+/g, "-") + "-motion.jpg");
			try { fs.unlinkSync(motionFile); } catch (e) { /* ignore */ }
			self.sendSocketNotification("MOTION_CLEAR", camKey);
		}, this.config.displayDuration || 30000);
	},

	refreshMotionSnapshot: async function (camKey) {
		// Take a new snapshot silently (don't send to frontend yet)
		var newUrl = await this.takeSnapshot(camKey, true);
		if (!newUrl) return;

		// Run detection on the new snapshot
		var detection = await this.runDetection(camKey);
		var types = this.motionDetectionTypes[camKey];
		if (!types) {
			// Motion was cleared while we were processing, just send the new snapshot
			this.sendSocketNotification("SNAPSHOT", { camera: camKey, url: newUrl });
			return;
		}

		// Check if any of the originally-detected object types are still in frame
		var stillPresent = false;
		if (types.person && detection.person) stillPresent = true;
		if (types.vehicle && detection.vehicle) stillPresent = true;
		if (types.animal && detection.animal) stillPresent = true;

		if (stillPresent) {
			// Object still visible — show the updated snapshot
			console.log("[MMM-RingSnapshot] Object still in frame on " + camKey + ", showing updated snapshot");
			this.sendSocketNotification("SNAPSHOT", { camera: camKey, url: newUrl });
		} else {
			// Object gone — fall back to the original detection snapshot
			console.log("[MMM-RingSnapshot] Object no longer in frame on " + camKey + ", showing original detection snapshot");
			this.sendSocketNotification("SNAPSHOT", { camera: camKey, url: this.motionOriginalUrls[camKey] });
		}
	},

	runDetection: function (camKey) {
		var snapshotPath = path.join(__dirname, "snapshot-" + camKey.toLowerCase().replace(/\s+/g, "-") + ".jpg");
		var pythonPath = path.join(__dirname, "venv", "bin", "python3");
		var scriptPath = path.join(__dirname, "detect_person.py");
		var personThreshold = String(this.config.personConfidence || 0.5);
		var vehicleThreshold = String(this.config.vehicleConfidence || 0.5);
		var animalThreshold = String(this.config.animalConfidence || 0.5);

		return new Promise(function (resolve) {
			execFile(pythonPath, [scriptPath, snapshotPath, personThreshold, vehicleThreshold, animalThreshold], { timeout: 30000 }, function (error, stdout) {
				if (error) {
					console.error("[MMM-RingSnapshot] Detection error:", error.message);
					resolve({ person: true, vehicle: true, animal: true }); // fail-open
					return;
				}
				try {
					var result = JSON.parse(stdout.trim());
					console.log("[MMM-RingSnapshot] Detection: " + camKey + " -> " + JSON.stringify(result));
					resolve(result);
				} catch (e) {
					console.error("[MMM-RingSnapshot] Detection parse error:", e.message);
					resolve({ person: true, vehicle: true, animal: true }); // fail-open
				}
			});
		});
	},

	takeSnapshot: async function (camKey, silent) {
		try {
			var snapshot = await this.cameras[camKey].getSnapshot();
			var snapshotPath = path.join(__dirname, "snapshot-" + camKey.toLowerCase().replace(/\s+/g, "-") + ".jpg");
			fs.writeFileSync(snapshotPath, snapshot);
			var url = "/modules/MMM-RingSnapshot/snapshot-" + camKey.toLowerCase().replace(/\s+/g, "-") + ".jpg?" + Date.now();
			if (!silent) {
				this.sendSocketNotification("SNAPSHOT", { camera: camKey, url: url });
			}
			console.log("[MMM-RingSnapshot] Snapshot saved for " + camKey + " (" + snapshot.length + " bytes)");
			return url;
		} catch (err) {
			console.error("[MMM-RingSnapshot] Snapshot error (" + camKey + "):", err.message);
			return null;
		}
	},

	stop: function () {
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
		}
		var keys = Object.keys(this.motionTimeouts);
		for (var i = 0; i < keys.length; i++) {
			clearTimeout(this.motionTimeouts[keys[i]]);
		}
		var intervalKeys = Object.keys(this.motionRefreshIntervals);
		for (var j = 0; j < intervalKeys.length; j++) {
			clearInterval(this.motionRefreshIntervals[intervalKeys[j]]);
		}
	},
});
