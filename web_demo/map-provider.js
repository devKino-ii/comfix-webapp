/* Map rendering stays separate so a production map can replace this file. */
(() => {
  const center = [14.515134, 121.238086];
  const colors = { New: "#252b31", Verified: "#3163c8", "In progress": "#ff9b1d", Resolved: "#248457" };

  class ComfixMap {
    constructor(element, onPick = () => {}) {
      this.element = element;
      this.onPick = onPick;
      this.markers = [];
      this.markerByReport = new Map();
      if (window.google?.maps) this.createGoogleMap();
      else if (window.L) this.createLeafletMap();
      else this.showFallback();
    }

    createGoogleMap() {
      this.provider = "Google Maps";
      this.map = new google.maps.Map(this.element, { center: { lat: center[0], lng: center[1] }, zoom: 15, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      this.map.addListener("click", event => this.onPick([event.latLng.lat(), event.latLng.lng()]));
    }

    createLeafletMap() {
      this.provider = "OpenStreetMap";
      this.map = L.map(this.element, { scrollWheelZoom: false }).setView(center, 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
      this.map.on("click", event => this.onPick([event.latlng.lat, event.latlng.lng]));
    }

    showFallback() {
      this.provider = "Map unavailable";
      this.element.classList.add("map-fallback");
      this.element.innerHTML = '<span class="fallback-map-icon">⌖</span><b>Map tiles unavailable</b><small>You can still report without a pin.</small>';
    }

    setPin(pin) {
      if (!this.map || !pin) return;
      if (this.provider === "Google Maps") {
        this.pinMarker?.setMap(null);
        this.pinMarker = new google.maps.Marker({ position: { lat: pin[0], lng: pin[1] }, map: this.map });
        this.map.panTo({ lat: pin[0], lng: pin[1] });
      } else {
        this.pinMarker?.remove();
        this.pinMarker = L.marker(pin).addTo(this.map);
        this.map.panTo(pin);
      }
    }

    clearPin() {
      if (!this.pinMarker) return;
      if (this.pinMarker.setMap) this.pinMarker.setMap(null);
      else this.pinMarker.remove();
      this.pinMarker = null;
    }

    setReports(reports, onSelect, selectedIds) {
      if (!this.map) return;
      this.onSelect = onSelect;
      const pinnedReports = reports.filter(report => report.pin);
      const dataSignature = JSON.stringify(pinnedReports.map(report => [report.ids, report.pin, report.status, report.count, report.title, report.displayNumber]));
      this.selectedKey = selectedIds ? selectedIds.join(",") : null;
      // Same data as before: keep the existing markers (no flicker, no view jump) and only move the highlight.
      if (dataSignature === this.dataSignature) { this.updateSelection(); return; }
      this.dataSignature = dataSignature;

      if (this.provider === "OpenStreetMap") {
        this.map.closePopup();
        this.layer.clearLayers();
      } else this.markers.forEach(marker => marker.setMap(null));
      this.markers = [];
      this.markerByReport.clear();
      pinnedReports.forEach(report => {
        const point = { lat: report.pin[0], lng: report.pin[1] };
        const color = colors[report.status] || colors.New;
        const reportKey = report.ids.join(",");
        const displayNumber = String(report.displayNumber ?? report.rank ?? "");
        const popupHtml = `<b>${escapeHtml(report.title)}</b><br>${escapeHtml(report.status)} · ${report.count} ${report.count === 1 ? "report" : "reports"}`;
        if (this.provider === "Google Maps") {
          const marker = new google.maps.Marker({ position: point, map: this.map, label: { text: displayNumber, color: "#ffffff", fontSize: "11px", fontWeight: "700" }, title: report.title, icon: this.googleIcon(color, false) });
          const info = new google.maps.InfoWindow({ content: popupHtml, disableAutoPan: true });
          marker.addListener("click", () => onSelect(report));
          this.markers.push(marker);
          this.markerByReport.set(reportKey, { marker, info, point, color, popupHtml });
        } else {
          const icon = L.divIcon({ className: "report-map-icon", html: `<span style="--pin-color:${color}"><b>${escapeHtml(displayNumber)}</b></span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
          const marker = L.marker([point.lat, point.lng], { icon, riseOnHover: true }).on("click", () => onSelect(report));
          marker.bindPopup(popupHtml, { autoPan: false, offset: [0, -6] });
          marker.addTo(this.layer);
          this.markers.push(marker);
          this.markerByReport.set(reportKey, { marker, point, popupHtml, color });
        }
      });
      this.updateSelection();

      const points = pinnedReports.map(report => report.pin);
      const pointSignature = points.map(point => point.join(",")).join("|");
      const changed = pointSignature !== this.pinSignature;
      const firstFit = this.pinSignature === undefined;
      this.pinSignature = pointSignature;
      this.lastPoints = points;
      // Only re-frame the map when the set of pins really changed, and never while a report is selected.
      if (!changed || this.selectedKey) return;
      this.frame(points, !firstFit);
    }

    googleIcon(color, selected) {
      return { path: google.maps.SymbolPath.CIRCLE, scale: selected ? 16 : 13, fillColor: color, fillOpacity: 1, strokeColor: selected ? "#ff9b1d" : "#ffffff", strokeWeight: selected ? 3 : 2 };
    }

    updateSelection() {
      this.markerByReport.forEach((entry, key) => {
        const selected = key === this.selectedKey;
        if (this.provider === "Google Maps") {
          entry.marker.setIcon(this.googleIcon(entry.color, selected));
          entry.marker.setZIndex(selected ? 1000 : undefined);
        } else {
          entry.marker.getElement()?.classList.toggle("is-selected", selected);
          entry.marker.setZIndexOffset(selected ? 1000 : 0);
        }
      });
    }

    frame(points, animate) {
      if (!points.length) return;
      if (this.provider === "Google Maps") {
        if (points.length === 1) { this.map.setCenter({ lat: points[0][0], lng: points[0][1] }); this.map.setZoom(15); return; }
        const bounds = new google.maps.LatLngBounds();
        points.forEach(point => bounds.extend({ lat: point[0], lng: point[1] }));
        this.map.fitBounds(bounds, 48);
      } else if (points.length === 1) {
        this.map.setView(points[0], 15, { animate });
      } else if (animate) {
        this.map.flyToBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16, duration: 1.1 });
      } else {
        this.map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16, animate: false });
      }
    }

    openReport(ids) {
      const entry = this.markerByReport.get(ids.join(","));
      if (!entry) return;
      this.selectedKey = ids.join(",");
      this.updateSelection();
      this.focusPoint(entry.point, () => {
        if (this.selectedKey !== ids.join(",")) return;
        if (this.provider === "Google Maps") { this.openInfo?.close(); this.openInfo = entry.info; entry.info.open({ map: this.map, anchor: entry.marker }); }
        else entry.marker.openPopup();
      });
      // Close the previous popup right away so it does not hang around during the glide.
      if (this.provider === "Google Maps") this.openInfo?.close();
      else this.map.closePopup();
    }

    // Space on the right is covered by the details panel on wide screens, so aim the view slightly left of the pin.
    panelShift() {
      const width = this.element.clientWidth;
      return width > 520 ? Math.min(330, width * 0.5) / 2 : 0;
    }

    focusPoint(point, done = () => {}) {
      const target = Array.isArray(point) ? { lat: point[0], lng: point[1] } : point;
      if (this.provider === "Google Maps") {
        const zoom = Math.max(this.map.getZoom() || 15, 16);
        this.map.panTo(target);                    // Google animates panning natively.
        this.stepZoom(zoom, done);
        return;
      }
      const zoom = Math.max(this.map.getZoom(), 16);
      const shifted = this.map.unproject(this.map.project([target.lat, target.lng], zoom).add([this.panelShift(), 0]), zoom);
      const distance = this.map.getCenter().distanceTo(shifted);
      this.map.stop();
      if (distance < 3) { done(); return; }
      this.map.once("moveend", done);
      // Short hops pan smoothly; long hops fly (zoom out, glide, zoom in).
      if (distance < 400 && this.map.getZoom() >= zoom) this.map.panTo(shifted, { animate: true, duration: 0.8, easeLinearity: 0.2 });
      else this.map.flyTo(shifted, zoom, { duration: Math.min(1.6, 0.7 + distance / 4000), easeLinearity: 0.2 });
    }

    // Google's setZoom jumps; step it so zooming looks smooth.
    stepZoom(zoom, done) {
      clearInterval(this.zoomTimer);
      const step = () => {
        const current = this.map.getZoom() || 15;
        if (current === zoom) { clearInterval(this.zoomTimer); setTimeout(done, 350); return; }
        this.map.setZoom(current + Math.sign(zoom - current));
      };
      this.zoomTimer = setInterval(step, 140);
      step();
    }

    overview() {
      if (!this.map || !this.lastPoints?.length) return;
      this.selectedKey = null;
      this.updateSelection();
      if (this.provider === "Google Maps") {
        this.openInfo?.close();
        this.frame(this.lastPoints, true);
      } else {
        this.map.closePopup();
        this.frame(this.lastPoints, true);
      }
    }

    resize() {
      if (this.provider === "OpenStreetMap" && this.map) setTimeout(() => this.map.invalidateSize(), 80);
      if (this.provider === "Google Maps" && this.map) google.maps.event.trigger(this.map, "resize");
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  window.ComfixMap = ComfixMap;
})();