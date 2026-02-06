Module.register("MMM-PowerButtons", {
	defaults: {
		showReboot: true,
		showShutdown: true,
		showMonitor: true
	},

	getStyles: function() {
		return ["MMM-PowerButtons.css"];
	},

	getDom: function() {
		var wrapper = document.createElement("div");
		wrapper.className = "power-buttons";

		if (this.config.showMonitor) {
			var monitorBtn = document.createElement("button");
			monitorBtn.className = "power-btn monitor-btn";
			monitorBtn.innerHTML = "⏾ Monitor Off";
			monitorBtn.onclick = function() {
				fetch("/api/monitor/toggle?apiKey=700ff172-94f0-43fd-8be3-b1148fd60a9f");
			};
			wrapper.appendChild(monitorBtn);
		}

		if (this.config.showReboot) {
			var rebootBtn = document.createElement("button");
			rebootBtn.className = "power-btn reboot-btn";
			rebootBtn.innerHTML = "↻ Reboot";
			rebootBtn.onclick = function() {
				fetch("/api/reboot?apiKey=700ff172-94f0-43fd-8be3-b1148fd60a9f");
			};
			wrapper.appendChild(rebootBtn);
		}

		if (this.config.showShutdown) {
			var shutdownBtn = document.createElement("button");
			shutdownBtn.className = "power-btn shutdown-btn";
			shutdownBtn.innerHTML = "⏻ Shutdown";
			shutdownBtn.onclick = function() {
				fetch("/api/shutdown?apiKey=700ff172-94f0-43fd-8be3-b1148fd60a9f");
			};
			wrapper.appendChild(shutdownBtn);
		}

		return wrapper;
	}
});
