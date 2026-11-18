const geocodeCache = new Map();
let geocodeQueue = Promise.resolve();
let lastGeocodeRequestAt = 0;
let selectedLocations = { start: null, destination: null };
let activeRouteController = null;

const fields = ["start", "destination"].map((name) => {
  const root = document.querySelector(`[data-field="${name}"]`);
  const input = root.querySelector("input");
  return {
    name,
    root,
    input,
    searchButton: root.querySelector(".search-button"),
    results: root.querySelector(".results"),
    selectedLabel: root.querySelector(".selected-place"),
    controller: null,
  };
});

const measureButton = document.querySelector("#measure-button");
const message = document.querySelector("#message");
const distanceResult = document.querySelector("#distance-result");
const distanceValue = document.querySelector("#distance-value");
const routeCaption = document.querySelector("#route-caption");
const mapLink = document.querySelector("#map-link");

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

function clearMessage() {
  message.textContent = "";
  message.hidden = true;
}

function updateMeasureButton() {
  measureButton.disabled = !selectedLocations.start || !selectedLocations.destination;
}

function clearRoute() {
  distanceResult.hidden = true;
  distanceValue.textContent = "—";
  routeCaption.textContent = "";
  mapLink.removeAttribute("href");
  if (activeRouteController) {
    activeRouteController.abort();
    activeRouteController = null;
  }
}

function closeResults(field) {
  field.results.replaceChildren();
  field.results.hidden = true;
}

function queueGeocode(url, signal) {
  const request = geocodeQueue.then(async () => {
    const delay = Math.max(0, 1000 - (Date.now() - lastGeocodeRequestAt));
    if (delay > 0) {
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(new DOMException("검색이 취소되었습니다.", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, delay);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    if (signal.aborted) {
      throw new DOMException("검색이 취소되었습니다.", "AbortError");
    }
    lastGeocodeRequestAt = Date.now();
    return fetch(url, { signal });
  });
  geocodeQueue = request.catch(() => {});
  return request;
}

function renderResults(field, places) {
  closeResults(field);
  if (places.length === 0) {
    showMessage("검색 결과가 없어요. 장소 이름을 조금 더 자세히 입력해 주세요.");
    return;
  }

  const options = places.map((place, index) => {
    const button = document.createElement("button");
    button.className = "result-option";
    button.type = "button";
    button.role = "option";
    button.setAttribute("aria-selected", "false");

    const title = document.createElement("strong");
    title.textContent = place.name || place.display_name.split(",")[0];
    const detail = document.createElement("small");
    detail.textContent = place.display_name;
    button.append(title, detail);
    button.addEventListener("click", () => {
      selectedLocations[field.name] = {
        lat: Number(place.lat),
        lon: Number(place.lon),
        label: place.display_name,
      };
      field.input.value = place.name || place.display_name.split(",")[0];
      field.selectedLabel.textContent = `선택됨 · ${place.display_name}`;
      closeResults(field);
      clearMessage();
      clearRoute();
      updateMeasureButton();
    });
    button.setAttribute("aria-label", `검색 결과 ${index + 1}: ${place.display_name}`);
    return button;
  });

  field.results.replaceChildren(...options);
  field.results.hidden = false;
}

async function searchPlace(field) {
  const query = field.input.value.trim();
  if (query.length < 2) {
    selectedLocations[field.name] = null;
    field.selectedLabel.textContent = "";
    updateMeasureButton();
    showMessage("장소 이름을 두 글자 이상 입력해 주세요.");
    return;
  }

  if (field.controller) {
    field.controller.abort();
  }
  const controller = new AbortController();
  field.controller = controller;
  closeResults(field);
  selectedLocations[field.name] = null;
  field.selectedLabel.textContent = "";
  clearMessage();
  clearRoute();
  measureButton.disabled = true;
  showMessage("실제 장소를 검색하고 있어요…");

  try {
    let places = geocodeCache.get(query.toLocaleLowerCase("ko"));
    if (!places) {
      const url = `/api/geocode?q=${encodeURIComponent(query)}`;
      const response = await queueGeocode(url, controller.signal);
      if (!response.ok) {
        throw new Error(response.status === 429
          ? "장소 검색이 잠시 제한되었어요. 잠시 후 다시 시도해 주세요."
          : "장소 검색에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
      places = await response.json();
      geocodeCache.set(query.toLocaleLowerCase("ko"), places);
    }
    if (controller.signal.aborted) return;
    clearMessage();
    renderResults(field, places);
  } catch (error) {
    if (error.name === "AbortError") return;
    showMessage(error.message || "장소 검색 중 문제가 발생했어요.");
    updateMeasureButton();
  }
}

for (const field of fields) {
  field.searchButton.addEventListener("click", () => searchPlace(field));
  field.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPlace(field);
    }
    if (event.key === "Escape") {
      closeResults(field);
    }
  });
  field.input.addEventListener("input", () => {
    selectedLocations[field.name] = null;
    field.selectedLabel.textContent = "";
    closeResults(field);
    clearRoute();
    clearMessage();
    updateMeasureButton();
  });
}

measureButton.addEventListener("click", async () => {
  const start = selectedLocations.start;
  const destination = selectedLocations.destination;
  if (!start || !destination) return;

  clearRoute();
  if (activeRouteController) {
    activeRouteController.abort();
  }
  const controller = new AbortController();
  activeRouteController = controller;
  measureButton.disabled = true;
  measureButton.classList.add("is-loading");
  measureButton.querySelector("span").textContent = "경로를 계산하고 있어요";
  clearMessage();

  try {
    const response = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { lat: start.lat, lon: start.lon },
        destination: { lat: destination.lat, lon: destination.lon },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(response.status === 404
        ? "두 장소 사이의 자동차 경로를 찾지 못했어요."
        : "경로를 계산하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    const route = await response.json();
    if (controller.signal.aborted) return;
    distanceValue.textContent = (route.distance / 1000).toLocaleString("ko-KR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    routeCaption.textContent = `${start.label.split(",")[0]} → ${destination.label.split(",")[0]}`;
    const coordinates = `${start.lat},${start.lon};${destination.lat},${destination.lon}`;
    mapLink.href = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(coordinates)}`;
    distanceResult.hidden = false;
  } catch (error) {
    if (error.name !== "AbortError") {
      showMessage(error.message || "경로를 계산하는 중 문제가 발생했어요.");
    }
  } finally {
    measureButton.disabled = !selectedLocations.start || !selectedLocations.destination;
    measureButton.classList.remove("is-loading");
    measureButton.querySelector("span").textContent = "거리 확인하기";
    if (activeRouteController === controller) {
      activeRouteController = null;
    }
  }
});
