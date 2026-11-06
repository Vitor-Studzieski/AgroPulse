"use client";

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Polygon, TileLayer, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import type { Field, Sensor } from "@/lib/api";

type GeoPoint = [number, number]; // longitude, latitude
type Props = {
  fields: Field[];
  selectedFieldId?: string;
  onSelect?: (id: string) => void;
  center?: [number, number]; // latitude, longitude
  drawPoints?: GeoPoint[];
  onDraw?: (point: GeoPoint) => void;
  sensors?: Sensor[];
  selectedSensorId?: string;
  onSelectSensor?: (id: string) => void;
  placementPoint?: GeoPoint;
  onPlaceSensor?: (point: GeoPoint) => void;
  mini?: boolean;
};

const cropColor = (crop: Field["crop"]): string => ({
  soja: "#7a9a2b",
  milho: "#e5a823",
  cana: "#1f8f86",
  cafe: "#5a5646",
  trigo: "#5a5646",
  algodao: "#5a5646",
})[crop];
const cropLabel: Record<Field["crop"], string> = { soja: "Soja", milho: "Milho", cana: "Cana-de-açúcar", cafe: "Café", trigo: "Trigo", algodao: "Algodão" };

function MapClick({ onDraw, onPlaceSensor }: { onDraw?: (point: GeoPoint) => void; onPlaceSensor?: (point: GeoPoint) => void }) {
  useMapEvents({ click: (event) => (onPlaceSensor ?? onDraw)?.([event.latlng.lng, event.latlng.lat]) });
  return null;
}

function MapResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => requestAnimationFrame(() => map.invalidateSize({ pan: false })));
    observer.observe(container);
    map.invalidateSize({ pan: false });
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function SensorFocus({ sensor }: { sensor?: Sensor }) {
  const map = useMap();
  const coordinates = sensor?.location?.coordinates;
  useEffect(() => {
    if (!coordinates) return;
    map.flyTo([coordinates[1], coordinates[0]], Math.max(map.getZoom(), 16), { duration: 0.45 });
  }, [coordinates?.[0], coordinates?.[1], map, sensor?.id]);
  return null;
}

function FieldLayers({ fields, selectedFieldId, drawPoints, center, onSelect }: Pick<Props, "fields" | "selectedFieldId" | "drawPoints" | "center" | "onSelect">) {
  const map = useMap();
  const drawing = drawPoints !== undefined;
  const features = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: fields.filter((field) => field.boundary?.coordinates?.length).map((field) => ({
      type: "Feature",
      properties: { id: field.id, name: field.name, area_ha: field.area_ha },
      geometry: field.boundary,
    })),
  }), [fields]);

  useEffect(() => {
    const polygons = L.geoJSON(features, {
      style: (feature): L.PathOptions => {
        const field = fields.find((item) => item.id === feature?.properties?.id);
        const active = feature?.properties?.id === selectedFieldId;
        return {
          color: active ? "#173d2a" : cropColor(field?.crop ?? "soja"),
          weight: active ? 3 : 2,
          opacity: 0.96,
          fillColor: cropColor(field?.crop ?? "soja"),
          fillOpacity: 0.35,
          bubblingMouseEvents: false,
        };
      },
      onEachFeature: (feature, layer) => {
        const name = String(feature.properties?.name ?? "Talhão");
        const field = fields.find((item) => item.id === feature.properties?.id);
        layer.bindTooltip(`${name} · ${cropLabel[field?.crop ?? "soja"]}`, { permanent: true, direction: "center", className: "field-label", opacity: 1 });
        layer.on("mouseover", () => { const id = String(feature.properties?.id ?? ""); if (id) onSelect?.(id); });
        layer.on("click", () => {
          const id = String(feature.properties?.id ?? "");
          if (id) onSelect?.(id);
        });
      },
    });
    polygons.addTo(map);
    return () => { polygons.remove(); };
  }, [features, fields, map, onSelect, selectedFieldId]);

  useEffect(() => {
    if (drawing) {
      if (center) map.setView(center, 14);
      return;
    }
    const coordinates = fields.flatMap((field) => field.boundary?.coordinates?.flatMap((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple)) ?? []);
    if (coordinates.length) map.fitBounds(L.latLngBounds(coordinates).pad(0.18), { maxZoom: 15, animate: false });
    else if (center) map.setView(center, 13);
  }, [center?.[0], center?.[1], drawing, fields, map]);

  return drawPoints?.length ? <>
    {drawPoints.length >= 3 && <Polygon positions={drawPoints.map(([lng, lat]) => [lat, lng])} pathOptions={{ color: "#416d45", weight: 2, dashArray: "6 5", fillColor: "#85a96f", fillOpacity: 0.35, interactive: false }}/>}
    {drawPoints.map(([lng, lat], index) => <CircleMarker key={`${lng}-${lat}-${index}`} center={[lat, lng]} radius={5} pathOptions={{ color: "#416d45", weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false }}/>)}</> : null;
}

function SensorMarkers({ sensors = [], selectedSensorId, onSelectSensor, placementPoint }: Pick<Props, "sensors" | "selectedSensorId" | "onSelectSensor" | "placementPoint">) {
  return <>
    {sensors.filter((sensor) => sensor.location?.coordinates).map((sensor) => {
      const [longitude, latitude] = sensor.location!.coordinates;
      const selected = sensor.id === selectedSensorId;
      const color = sensor.active ? (sensor.source === "real" ? "#397ca8" : "#1f8f86") : "#858f88";
      return <CircleMarker
        key={sensor.id}
        center={[latitude, longitude]}
        radius={selected ? 9 : 7}
        pathOptions={{ color: selected ? "#fff" : color, weight: selected ? 3 : 2, fillColor: color, fillOpacity: sensor.active ? 0.95 : 0.6, bubblingMouseEvents: false }}
        eventHandlers={{ click: () => onSelectSensor?.(sensor.id) }}
      />;
    })}
    {placementPoint && <CircleMarker center={[placementPoint[1], placementPoint[0]]} radius={10} pathOptions={{ color: "#fff", weight: 3, fillColor: "#d48628", fillOpacity: 1, interactive: false }}/>}
  </>;
}

export default function LeafletMap({ fields, selectedFieldId, onSelect, center = [-15.78, -47.93], drawPoints, onDraw, sensors, selectedSensorId, onSelectSensor, placementPoint, onPlaceSensor, mini = false }: Props) {
  const [baseLayer, setBaseLayer] = useState<"satellite" | "map">("satellite");
  const selectedSensor = sensors?.find((sensor) => sensor.id === selectedSensorId);
  const placementMode = onPlaceSensor !== undefined;
  return <div className={`map-frame ${drawPoints !== undefined ? "map-draw-mode" : ""} ${placementMode ? "sensor-placement-mode" : ""}`}>
    <MapContainer center={center} zoom={fields.length ? 13 : 5} scrollWheelZoom className="leaflet-field-map" zoomControl={false}>
      {!mini && <ZoomControl position="bottomright"/>}
      <MapResize/>
      {baseLayer === "satellite" ? <TileLayer attribution='Tiles &copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"/> : <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>}
      <FieldLayers fields={fields} selectedFieldId={selectedFieldId} drawPoints={drawPoints} center={center} onSelect={onSelect}/>
      <SensorMarkers sensors={sensors} selectedSensorId={selectedSensorId} onSelectSensor={onSelectSensor} placementPoint={placementPoint}/>
      {selectedSensor && <SensorFocus sensor={selectedSensor}/>}
      {(drawPoints !== undefined || placementMode) && <MapClick onDraw={onDraw} onPlaceSensor={onPlaceSensor}/>}
    </MapContainer>
    {!mini && <div className="map-layer-switch" role="group" aria-label="Camada do mapa"><button type="button" className={baseLayer === "satellite" ? "active" : ""} onClick={() => setBaseLayer("satellite")}>Satélite</button><button type="button" className={baseLayer === "map" ? "active" : ""} onClick={() => setBaseLayer("map")}>Mapa</button></div>}
    {drawPoints !== undefined && <div className="map-help">Clique no mapa para adicionar vértices <span>·</span> {drawPoints.length} ponto{drawPoints.length === 1 ? "" : "s"}</div>}
    {placementMode && <div className="map-help">Clique dentro do talhão para posicionar o sensor</div>}
  </div>;
}
