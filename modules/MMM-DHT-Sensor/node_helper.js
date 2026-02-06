const NodeHelper = require("node_helper");
const fs = require("fs");

const TEMP_PATH = "/sys/devices/platform/dht11@4/iio:device0/in_temp_input";
const HUM_PATH = "/sys/devices/platform/dht11@4/iio:device0/in_humidityrelative_input";

module.exports = NodeHelper.create({
	start: function () {
		this.timer = null;
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "START_READING") {
			this.config = payload;
			this.readSensor();
		}
	},

	readSensor: function () {
		try {
			var tempRaw = fs.readFileSync(TEMP_PATH, "utf8").trim();
			var humRaw = fs.readFileSync(HUM_PATH, "utf8").trim();
			this.sendSocketNotification("SENSOR_DATA", {
				temp: parseInt(tempRaw, 10) / 1000,
				humidity: parseInt(humRaw, 10) / 1000,
			});
		} catch (err) {
			// sensor read failed, skip this cycle
		}

		var self = this;
		this.timer = setTimeout(function () {
			self.readSensor();
		}, this.config.updateInterval || 10000);
	},

	stop: function () {
		if (this.timer) {
			clearTimeout(this.timer);
		}
	},
});
