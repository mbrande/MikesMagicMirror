Module.register("MMM-pihole-activity", {
	defaults: {
		apiURL: "http://pi.hole/api",
		password: "",
		maxLines: 20,
		updateInterval: 1000
	},

	start: function () {
		Log.info("Starting module: " + this.name);
		this.logPre = null;
		this.placeholder = null;
		this.sendSocketNotification("START", this.config);
	},

	getStyles: function () {
		return ["MMM-pihole-activity.css"];
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		wrapper.className = "pihole-activity";

		this.placeholder = document.createElement("div");
		this.placeholder.className = "dimmed light small";
		this.placeholder.textContent = "Connecting to Pi-hole...";
		wrapper.appendChild(this.placeholder);

		this.logPre = document.createElement("pre");
		this.logPre.className = "pihole-log";
		this.logPre.style.display = "none";
		wrapper.appendChild(this.logPre);

		return wrapper;
	},

	appendLogLine: function (entry) {
		if (!this.logPre) return;

		// Hide placeholder, show log on first entry
		if (this.placeholder && this.placeholder.style.display !== "none") {
			this.placeholder.style.display = "none";
			this.logPre.style.display = "block";
		}

		var div = document.createElement("div");
		div.className = "pihole-line pihole-fade-in";

		var ts = this.formatTimestamp(entry.timestamp);
		var formatted = this.formatLine(entry.message);

		var timeSpan = document.createElement("span");
		timeSpan.className = "pihole-timestamp";
		timeSpan.textContent = ts + " ";

		var msgSpan = document.createElement("span");
		if (formatted.blocked) {
			msgSpan.className = "pihole-blocked";
		} else if (formatted.isQuery) {
			msgSpan.className = "pihole-query";
		} else {
			msgSpan.className = "pihole-muted";
		}
		msgSpan.textContent = formatted.text;

		div.appendChild(timeSpan);
		div.appendChild(msgSpan);
		this.logPre.appendChild(div);

		// Trim old entries from the top
		while (this.logPre.children.length > this.config.maxLines) {
			this.logPre.removeChild(this.logPre.firstChild);
		}
	},

	formatLine: function (message) {
		// Remove dnsmasq[PID] like Pi-hole admin does
		var txt = message.replace(/ dnsmasq\[\d*\]/g, "");
		var blocked = (message.indexOf("denied") !== -1 || message.indexOf("blocked") !== -1);
		var isQuery = message.indexOf("query[") !== -1;
		return { text: txt, blocked: blocked, isQuery: isQuery };
	},

	formatTimestamp: function (unixSeconds) {
		var date = new Date(unixSeconds * 1000);
		var y = date.getFullYear();
		var mo = String(date.getMonth() + 1).padStart(2, "0");
		var d = String(date.getDate()).padStart(2, "0");
		var h = String(date.getHours()).padStart(2, "0");
		var mi = String(date.getMinutes()).padStart(2, "0");
		var s = String(date.getSeconds()).padStart(2, "0");
		var ms = String(date.getMilliseconds()).padStart(3, "0");
		return y + "-" + mo + "-" + d + " " + h + ":" + mi + ":" + s + "." + ms;
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "LOG_ENTRIES") {
			for (var i = 0; i < payload.length; i++) {
				this.appendLogLine(payload[i]);
			}
		} else if (notification === "STATUS") {
			if (payload === "connected" && this.placeholder) {
				this.placeholder.textContent = "Waiting for activity...";
			}
		}
	}
});
