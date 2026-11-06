import { Field, Sensor } from "@/lib/api";

export type LonLat = [longitude: number, latitude: number];

function pointInRing([longitude, latitude]: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > latitude) !== (y2 > latitude) && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

export function pointInField(point: LonLat, field: Field): boolean {
  const rings = field.boundary?.coordinates ?? [];
  if (!rings.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

export function suggestSensorPosition(field: Field, occupied: LonLat[] = []): LonLat {
  const outer = field.boundary.coordinates[0];
  if (!outer?.length) return field.centroid?.coordinates ?? [-50.2, -22.1];
  const longitudes = outer.map(([longitude]) => longitude);
  const latitudes = outer.map(([, latitude]) => latitude);
  const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
  const center = field.centroid?.coordinates ?? [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
  const cosLat = Math.max(0.01, Math.cos((center[1] * Math.PI) / 180));
  const candidates: LonLat[] = [];
  const seen = new Set<string>();
  const targetCandidates = Math.max(32, occupied.length + 1);
  for (const gridSize of [18, 32, 56, 96, 160, 256]) {
    for (let row = 0; row < gridSize; row += 1) {
      for (let column = 0; column < gridSize; column += 1) {
        const point: LonLat = [minLon + ((column + 0.5) / gridSize) * (maxLon - minLon), minLat + ((row + 0.5) / gridSize) * (maxLat - minLat)];
        const key = `${point[0].toFixed(12)},${point[1].toFixed(12)}`;
        if (!seen.has(key) && pointInField(point, field)) { candidates.push(point); seen.add(key); }
      }
    }
    if (candidates.length >= targetCandidates) break;
  }
  const scanLatitudes = [...new Set(field.boundary.coordinates.flatMap((ring) => ring.slice(0, -1).map((point) => point[1])))].sort((a, b) => a - b);
  for (let index = 0; index < scanLatitudes.length - 1; index += 1) {
    const latitude = (scanLatitudes[index] + scanLatitudes[index + 1]) / 2;
    const intersections: number[] = [];
    for (const ring of field.boundary.coordinates) {
      for (let pointIndex = 0; pointIndex < ring.length - 1; pointIndex += 1) {
        const first = ring[pointIndex], second = ring[pointIndex + 1];
        if ((first[1] > latitude) !== (second[1] > latitude)) intersections.push(first[0] + ((second[0] - first[0]) * (latitude - first[1])) / (second[1] - first[1]));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let pointIndex = 0; pointIndex < intersections.length - 1; pointIndex += 2) {
      const point: LonLat = [(intersections[pointIndex] + intersections[pointIndex + 1]) / 2, latitude];
      const key = `${point[0].toFixed(12)},${point[1].toFixed(12)}`;
      if (!seen.has(key) && pointInField(point, field)) { candidates.push(point); seen.add(key); }
    }
  }
  if (occupied.length && candidates.length) {
    return candidates.reduce((best, candidate) => {
      const score = Math.min(...occupied.map(([longitude, latitude]) => ((candidate[0] - longitude) * cosLat) ** 2 + (candidate[1] - latitude) ** 2));
      const bestScore = Math.min(...occupied.map(([longitude, latitude]) => ((best[0] - longitude) * cosLat) ** 2 + (best[1] - latitude) ** 2));
      return score > bestScore ? candidate : best;
    }, candidates[0]);
  }
  if (candidates.length) return candidates.reduce((best, candidate) => {
    const score = ((candidate[0] - center[0]) * cosLat) ** 2 + (candidate[1] - center[1]) ** 2;
    const bestScore = ((best[0] - center[0]) * cosLat) ** 2 + (best[1] - center[1]) ** 2;
    return score < bestScore ? candidate : best;
  }, candidates[0]);
  return pointInField(center, field) ? [...center] as LonLat : [...outer[0]] as LonLat;
}

export function locateSensors(fields: Field[], sensors: Sensor[]): Sensor[] {
  const locations = new Map<string, LonLat>();
  for (const field of fields) {
    const group = sensors.filter((sensor) => sensor.field_id === field.id).sort((a, b) => a.device_id.localeCompare(b.device_id, "pt-BR"));
    const occupied = group.flatMap((sensor) => sensor.location?.coordinates ? [sensor.location.coordinates as LonLat] : []);
    group.filter((sensor) => !sensor.location?.coordinates).forEach((sensor) => {
      const position = suggestSensorPosition(field, occupied);
      locations.set(sensor.id, position);
      occupied.push(position);
    });
  }
  return sensors.map((sensor) => {
    const position = locations.get(sensor.id);
    return position ? { ...sensor, location: { type: "Point", coordinates: position } } : sensor;
  });
}
