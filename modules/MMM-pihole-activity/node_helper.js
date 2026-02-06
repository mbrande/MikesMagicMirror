const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
	sid: null,
	nextID: 0,
	lastPID: -1,
	pollTimer: null,

	start: function () {
		console.log("[MMM-pihole-activity] Node helper starting...");
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "START") {
			this.config = payload;
			var self = this;
			this.authenticate().then(function () {
				self.pollLogs();
			});
		}
	},

	authenticate: async function () {
		var url = this.config.apiURL + "/auth";
		try {
			var response = await fetch(url, {
				method: "POST",
				body: JSON.stringify({ password: this.config.password }),
				headers: { "Content-Type": "application/json" }
			});
			if (!response.ok) throw new Error("Auth failed: " + response.status);
			var data = await response.json();
			this.sid = data.session.sid;
			console.log("[MMM-pihole-activity] Authenticated with Pi-hole API");
			this.sendSocketNotification("STATUS", "connected");
		} catch (err) {
			console.error("[MMM-pihole-activity] Auth error:", err.message);
			this.sendSocketNotification("STATUS", "disconnected");
		}
	},

	pollLogs: async function () {
		var url = this.config.apiURL + "/logs/dnsmasq?nextID=" + this.nextID;
		try {
			var headers = {};
			if (this.sid) headers.sid = this.sid;
			var response = await fetch(url, { headers: headers });

			if (response.status === 401) {
				console.log("[MMM-pihole-activity] Session expired, re-authenticating...");
				await this.authenticate();
				this.schedulePoll();
				return;
			}

			if (!response.ok) throw new Error("HTTP " + response.status);

			var data = await response.json();

			// Check for FTL restart
			if (this.lastPID !== -1 && this.lastPID !== data.pid) {
				console.log("[MMM-pihole-activity] FTL restarted, resetting...");
				this.nextID = 0;
				this.lastPID = data.pid;
				this.pollLogs();
				return;
			}
			this.lastPID = data.pid;

			// Send new log lines to frontend
			if (data.log && data.log.length > 0) {
				this.sendSocketNotification("LOG_ENTRIES", data.log);
			}

			this.nextID = data.nextID;
		} catch (err) {
			console.error("[MMM-pihole-activity] Poll error:", err.message);
		}

		this.schedulePoll();
	},

	schedulePoll: function () {
		var self = this;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		this.pollTimer = setTimeout(function () {
			self.pollLogs();
		}, self.config.updateInterval || 1000);
	},

	stop: function () {
		if (this.pollTimer) clearTimeout(this.pollTimer);
	}
});
