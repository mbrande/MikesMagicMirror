Module.register("MMM-DHT-Sensor", {
	defaults: {
		updateInterval: 10000,
		showHumidity: true,
		useFahrenheit: true,
	},

	start: function () {
		this.temp = null;
		this.humidity = null;
		this.sendSocketNotification("START_READING", this.config);
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "SENSOR_DATA") {
			this.temp = payload.temp;
			this.humidity = payload.humidity;
			this.updateDom();
		}
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		wrapper.className = "dht-sensor";

		if (this.temp === null) {
			wrapper.innerHTML = "Reading sensor...";
			wrapper.className += " dimmed small";
			return wrapper;
		}

		var tempVal = this.config.useFahrenheit
			? (this.temp * 9) / 5 + 32
			: this.temp;
		var unit = this.config.useFahrenheit ? "F" : "C";

		var tempDiv = document.createElement("div");
		tempDiv.className = "dht-temp bright large";
		tempDiv.innerHTML = tempVal.toFixed(1) + "&deg;" + unit;
		wrapper.appendChild(tempDiv);

		if (this.config.showHumidity && this.humidity !== null) {
			var humDiv = document.createElement("div");
			humDiv.className = "dht-humidity dimmed small";
			humDiv.innerHTML = "Humidity: " + this.humidity.toFixed(0) + "%";
			wrapper.appendChild(humDiv);
		}

		return wrapper;
	},
});
