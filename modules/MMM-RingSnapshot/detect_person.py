#!/usr/bin/env python3
"""Detect persons and vehicles in an image using a quantized SSD MobileNet v1 COCO TFLite model."""

import json
import sys

import numpy as np
from PIL import Image

# COCO SSD MobileNet class indices (0-indexed)
PERSON_CLASS = 0
VEHICLE_CLASSES = {1, 2, 3, 5, 7}  # bicycle, car, motorcycle, bus, truck
ANIMAL_CLASSES = {14, 15, 16, 17, 18, 19, 20, 21, 22, 23}  # bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe


def detect(image_path, person_threshold=0.5, vehicle_threshold=0.5, animal_threshold=0.5):
    from ai_edge_litert.interpreter import Interpreter

    model_path = sys.path[0] + "/model/detect.tflite"

    interpreter = Interpreter(model_path=model_path)
    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    height = input_details[0]["shape"][1]
    width = input_details[0]["shape"][2]

    img = Image.open(image_path).convert("RGB")
    img = img.resize((width, height))
    input_data = np.expand_dims(np.array(img, dtype=np.uint8), axis=0)

    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()

    # Output tensors: boxes, classes, scores, count
    classes = interpreter.get_tensor(output_details[1]["index"])[0]
    scores = interpreter.get_tensor(output_details[2]["index"])[0]

    best_person_score = 0.0
    best_vehicle_score = 0.0
    best_animal_score = 0.0
    for i in range(len(scores)):
        cls = int(classes[i])
        score = float(scores[i])
        if cls == PERSON_CLASS and score > best_person_score:
            best_person_score = score
        elif cls in VEHICLE_CLASSES and score > best_vehicle_score:
            best_vehicle_score = score
        elif cls in ANIMAL_CLASSES and score > best_animal_score:
            best_animal_score = score

    return {
        "person": best_person_score >= person_threshold,
        "personConfidence": round(best_person_score, 3),
        "vehicle": best_vehicle_score >= vehicle_threshold,
        "vehicleConfidence": round(best_vehicle_score, 3),
        "animal": best_animal_score >= animal_threshold,
        "animalConfidence": round(best_animal_score, 3),
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: detect_person.py <image_path> [person_threshold] [vehicle_threshold] [animal_threshold]"}))
        sys.exit(1)

    image_path = sys.argv[1]
    person_thresh = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
    vehicle_thresh = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
    animal_thresh = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5

    try:
        result = detect(image_path, person_thresh, vehicle_thresh, animal_thresh)
    except Exception as e:
        result = {"error": str(e), "person": True, "personConfidence": 0, "vehicle": True, "vehicleConfidence": 0, "animal": True, "animalConfidence": 0}

    print(json.dumps(result))
