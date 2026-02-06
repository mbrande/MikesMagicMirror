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

		// Run detection if either person or vehicle detection is enabled
		if (this.config.personDetection !== false || this.config.vehicleDetection !== false || this.config.animalDetection !== false) {
			var detection = await this.runDetection(camKey);
			var personFound = this.config.personDetection !== false && detection.person;
			var vehicleFound = this.config.vehicleDetection !== false && detection.vehicle;
			var animalFound = this.config.animalDetection !== false && detection.animal;
			if (!personFound && !vehicleFound && !animalFound) {
				console.log("[MMM-RingSnapshot] No person/vehicle/animal detected on " + camKey + ", skipping alert");
				return;
			}
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

		// Refresh snapshots every 5 seconds during motion to catch continued activity
		var self = this;
		this.motionRefreshIntervals[camKey] = setInterval(function () {
			self.takeSnapshot(camKey);
		}, 5000);

		// Clear motion highlight and stop refresh after duration
		this.motionTimeouts[camKey] = setTimeout(function () {
			if (self.motionRefreshIntervals[camKey]) {
				clearInterval(self.motionRefreshIntervals[camKey]);
				delete self.motionRefreshIntervals[camKey];
			}
			self.sendSocketNotification("MOTION_CLEAR", camKey);
		}, this.config.displayDuration || 30000);
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

	takeSnapshot: async function (camKey) {
		try {
			var snapshot = await this.cameras[camKey].getSnapshot();
			var snapshotPath = path.join(__dirname, "snapshot-" + camKey.toLowerCase().replace(/\s+/g, "-") + ".jpg");
			fs.writeFileSync(snapshotPath, snapshot);
			var url = "/modules/MMM-RingSnapshot/snapshot-" + camKey.toLowerCase().replace(/\s+/g, "-") + ".jpg?" + Date.now();
			this.sendSocketNotification("SNAPSHOT", { camera: camKey, url: url });
			console.log("[MMM-RingSnapshot] Snapshot saved for " + camKey + " (" + snapshot.length + " bytes)");
		} catch (err) {
			console.error("[MMM-RingSnapshot] Snapshot error (" + camKey + "):", err.message);
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
