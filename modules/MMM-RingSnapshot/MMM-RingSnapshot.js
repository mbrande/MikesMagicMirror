Module.register("MMM-RingSnapshot", {
	defaults: {
		displayDuration: 30000,
		cameras: ["Front Door", "Driveway"],
		pollInterval: 15000,
		snapshotInterval: 300000,
		personDetection: true,
		personConfidence: 0.5,
		vehicleDetection: true,
		vehicleConfidence: 0.5,
		animalDetection: true,
		animalConfidence: 0.5,
	},

	start: function () {
		this.snapshots = {};
		this.motionActive = {};
		this.cameraList = [];
		this.imageElements = {};
		this.cardElements = {};
		this.labelElements = {};
		this.sendSocketNotification("START", this.config);
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "CAMERAS_READY") {
			this.cameraList = payload;
			this.updateDom(300);
		} else if (notification === "SNAPSHOT") {
			this.snapshots[payload.camera] = payload.url;
			// Update image src directly if element exists, no DOM rebuild
			if (this.imageElements[payload.camera]) {
				this.imageElements[payload.camera].src = payload.url;
			} else {
				this.updateDom(300);
			}
		} else if (notification === "MOTION") {
			this.motionActive[payload] = true;
			// Update classes directly if elements exist
			if (this.cardElements[payload]) {
				this.cardElements[payload].classList.add("ring-motion");
				this.labelElements[payload].innerHTML = "MOTION: " + payload;
				this.labelElements[payload].classList.add("bright");
				this.labelElements[payload].classList.remove("dimmed");
			} else {
				this.updateDom(300);
			}
		} else if (notification === "MOTION_CLEAR") {
			this.motionActive[payload] = false;
			if (this.cardElements[payload]) {
				this.cardElements[payload].classList.remove("ring-motion");
				this.labelElements[payload].innerHTML = payload;
				this.labelElements[payload].classList.remove("bright");
				this.labelElements[payload].classList.add("dimmed");
			} else {
				this.updateDom(300);
			}
		}
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		wrapper.className = "ring-wrapper";

		if (this.cameraList.length === 0) {
			wrapper.innerHTML = '<span class="dimmed small">Connecting to Ring...</span>';
			return wrapper;
		}

		this.imageElements = {};
		this.cardElements = {};
		this.labelElements = {};

		for (var i = 0; i < this.cameraList.length; i++) {
			var camKey = this.cameraList[i];
			var card = document.createElement("div");
			card.className = "ring-card";

			if (this.motionActive[camKey]) {
				card.className += " ring-motion";
			}

			this.cardElements[camKey] = card;

			var label = document.createElement("div");
			label.className = "ring-label xsmall";
			if (this.motionActive[camKey]) {
				label.innerHTML = "MOTION: " + camKey;
				label.className += " bright";
			} else {
				label.innerHTML = camKey;
				label.className += " dimmed";
			}
			this.labelElements[camKey] = label;
			card.appendChild(label);

			if (this.snapshots[camKey]) {
				var img = document.createElement("img");
				img.className = "ring-img";
				img.src = this.snapshots[camKey];
				this.imageElements[camKey] = img;
				card.appendChild(img);
			} else {
				var placeholder = document.createElement("div");
				placeholder.className = "ring-placeholder dimmed xsmall";
				placeholder.innerHTML = "Waiting for snapshot...";
				card.appendChild(placeholder);
			}

			wrapper.appendChild(card);
		}

		return wrapper;
	},

	getStyles: function () {
		return ["MMM-RingSnapshot.css"];
	},
});
