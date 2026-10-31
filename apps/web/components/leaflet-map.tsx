"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Polygon, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Field } from "@/lib/api";

type GeoPoint = [number, number]; // longitude, latitude
type Props = {
  fields: Field[];
  selectedFieldId?: string;
  onSelect?: (id: string) => void;
  center?: [number, number]; // latitude, longitude
  drawPoints?: GeoPoint[];
  onDraw?: (point: GeoPoint) => void;
};

const colors = ["#5e8d57", "#c29c50", "#46887a", "#81994c", "#718ca0"];

function MapClick({ onDraw }: { onDraw?: (point: GeoPoint) => void }) {
  useMapEvents({ click: (event) => onDraw?.([event.latlng.lng, event.latlng.lat]) });
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
        const index = Math.max(0, fields.findIndex((field) => field.id === feature?.properties?.id));
        const active = feature?.properties?.id === selectedFieldId;
        return {
          color: active ? "#294b32" : colors[index % colors.length],
          weight: active ? 3 : 2,
          opacity: 0.96,
          fillColor: colors[index % colors.length],
          fillOpacity: active ? 0.46 : 0.28,
          bubblingMouseEvents: false,
        };
      },
      onEachFeature: (feature, layer) => {
        const name = String(feature.properties?.name ?? "Talhão");
        const area = Number(feature.properties?.area_ha ?? 0);
        layer.bindTooltip(`${name} · ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(area)} ha`);
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
    const selected = fields.find((field) => field.id === selectedFieldId);
    const target = selected ? [selected] : fields;
    const coordinates = target.flatMap((field) => field.boundary?.coordinates?.flatMap((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple)) ?? []);
    if (coordinates.length) map.fitBounds(L.latLngBounds(coordinates).pad(0.18), { maxZoom: 15, animate: false });
    else if (center) map.setView(center, 13);
  }, [center?.[0], center?.[1], drawing, fields, map, selectedFieldId]);

  return drawPoints?.length ? <>
    {drawPoints.length >= 3 && <Polygon positions={drawPoints.map(([lng, lat]) => [lat, lng])} pathOptions={{ color: "#416d45", weight: 2, dashArray: "6 5", fillColor: "#85a96f", fillOpacity: 0.35, interactive: false }}/>}
    {drawPoints.map(([lng, lat], index) => <CircleMarker key={`${lng}-${lat}-${index}`} center={[lat, lng]} radius={5} pathOptions={{ color: "#416d45", weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false }}/>)}</> : null;
}

export default function LeafletMap({ fields, selectedFieldId, onSelect, center = [-15.78, -47.93], drawPoints, onDraw }: Props) {
  return <div className={`map-frame ${drawPoints !== undefined ? "map-draw-mode" : ""}`}>
    <MapContainer center={center} zoom={fields.length ? 13 : 5} scrollWheelZoom className="leaflet-field-map" zoomControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
      <FieldLayers fields={fields} selectedFieldId={selectedFieldId} drawPoints={drawPoints} center={center} onSelect={onSelect}/>
      {drawPoints !== undefined && <MapClick onDraw={onDraw}/>}
    </MapContainer>
    {drawPoints !== undefined && <div className="map-help">Clique no mapa para adicionar vértices <span>·</span> {drawPoints.length} ponto{drawPoints.length === 1 ? "" : "s"}</div>}
  </div>;
}
