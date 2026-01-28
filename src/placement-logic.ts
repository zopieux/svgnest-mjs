import ClipperLib from 'js-clipper';
import GeometryUtil from './util/geometry.js';
import { Point, Polygon, Config, Placement, Result } from './types.js';

function clonePolygon(polygon: Polygon): Polygon {
  const clone: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    clone.push({
      X: polygon[i].X,
      Y: polygon[i].Y
    });
  }
  return clone as Polygon;
}

function scalePolygon(polygon: Point[], scale: number): Point[] {
  const clone: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    clone.push({
      X: polygon[i].X / scale,
      Y: polygon[i].Y / scale
    });
  }
  return clone;
}

function rotatePolygon(polygon: Polygon, degrees: number): Polygon {
  const rotated = [] as unknown as Polygon;
  const angle = degrees * Math.PI / 180;
  for (let i = 0; i < polygon.length; i++) {
    const x = polygon[i].X;
    const y = polygon[i].Y;
    const x1 = x * Math.cos(angle) - y * Math.sin(angle);
    const y1 = x * Math.sin(angle) + y * Math.cos(angle);

    rotated.push({ X: x1, Y: y1 });
  }

  if (polygon.children && polygon.children.length > 0) {
    rotated.children = [];
    for (let j = 0; j < polygon.children.length; j++) {
      rotated.children.push(rotatePolygon(polygon.children[j], degrees));
    }
  }

  return rotated;
}

interface PlacePathsParams {
  binPolygon: Polygon;
  paths: Polygon[];
  ids: number[];
  rotations: number[];
  config: Config;
  nfpCache: Record<string, Point[][]>;
}

export function placePaths({ binPolygon, paths, ids, rotations, config, nfpCache }: PlacePathsParams): Result | null {
  if (!binPolygon) {
    return null;
  }

  const rotated: Polygon[] = [];
  for (let i = 0; i < paths.length; i++) {
    const r = rotatePolygon(paths[i], rotations[i]);
    r.rotation = rotations[i];
    r.source = paths[i].source;
    r.id = ids[i];
    rotated.push(r);
  }

  let pathsToPlace = rotated;

  const allplacements: Placement[][] = [];
  let fitness = 0;
  const binarea = Math.abs(GeometryUtil.polygonArea(binPolygon));
  let key: string, nfp: Point[][];

  while (pathsToPlace.length > 0) {
    const placed: Polygon[] = [];
    const placements: Placement[] = [];
    fitness += 1;
    let minwidth: number | null = null;

    for (let i = 0; i < pathsToPlace.length; i++) {
      const path = pathsToPlace[i];

      key = JSON.stringify({ A: -1, B: path.id, inside: true, Arotation: 0, Brotation: path.rotation });
      const binNfp = nfpCache[key];

      if (!binNfp || binNfp.length === 0) {
        continue;
      }

      let error = false;
      for (let j = 0; j < placed.length; j++) {
        key = JSON.stringify({ A: placed[j].id, B: path.id, inside: false, Arotation: placed[j].rotation, Brotation: path.rotation });
        nfp = nfpCache[key];

        if (!nfp) {
          error = true;
          break;
        }
      }

      if (error) {
        continue;
      }

      let position: Placement | null = null;
      if (placed.length === 0) {
        for (let j = 0; j < binNfp.length; j++) {
          for (let k = 0; k < binNfp[j].length; k++) {
            if (position === null || binNfp[j][k].X - path[0].X < position.x) {
              position = {
                x: binNfp[j][k].X - path[0].X,
                y: binNfp[j][k].Y - path[0].Y,
                id: path.id!,
                rotation: path.rotation!
              };
            }
          }
        }

        if (position) {
          placements.push(position);
          placed.push(path);
        }
        continue;
      }

      const clipperBinNfp: Point[][] = [];
      for (let j = 0; j < binNfp.length; j++) {
        clipperBinNfp.push(clonePolygon(binNfp[j]));
      }

      ClipperLib.JS.ScaleUpPaths(clipperBinNfp, config.clipperScale);

      let clipper = new ClipperLib.Clipper();
      const combinedNfp = new ClipperLib.Paths();

      for (let j = 0; j < placed.length; j++) {
        key = JSON.stringify({ A: placed[j].id, B: path.id, inside: false, Arotation: placed[j].rotation, Brotation: path.rotation });
        nfp = nfpCache[key];

        if (!nfp) {
          continue;
        }

        for (let k = 0; k < nfp.length; k++) {
          let clone = clonePolygon(nfp[k]);
          for (let m = 0; m < clone.length; m++) {
            clone[m].X += placements[j].x;
            clone[m].Y += placements[j].y;
          }

          ClipperLib.JS.ScaleUpPath(clone, config.clipperScale);
          clone = ClipperLib.Clipper.CleanPolygon(clone, 0.0001 * config.clipperScale);
          const area = Math.abs(ClipperLib.Clipper.Area(clone));
          if (clone.length > 2 && area > 0.1 * config.clipperScale * config.clipperScale) {
            clipper.AddPath(clone, ClipperLib.PolyType.ptSubject, true);
          }
        }
      }

      if (!clipper.Execute(ClipperLib.ClipType.ctUnion, combinedNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) {
        continue;
      }

      let finalNfp = new ClipperLib.Paths();
      clipper = new ClipperLib.Clipper();

      clipper.AddPaths(combinedNfp, ClipperLib.PolyType.ptClip, true);
      clipper.AddPaths(clipperBinNfp, ClipperLib.PolyType.ptSubject, true);
      if (!clipper.Execute(ClipperLib.ClipType.ctDifference, finalNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) {
        continue;
      }

      finalNfp = ClipperLib.Clipper.CleanPolygons(finalNfp, 0.0001 * config.clipperScale);

      for (let j = 0; j < finalNfp.length; j++) {
        const area = Math.abs(ClipperLib.Clipper.Area(finalNfp[j]));
        if (finalNfp[j].length < 3 || area < 0.1 * config.clipperScale * config.clipperScale) {
          finalNfp.splice(j, 1);
          j--;
        }
      }

      if (!finalNfp || finalNfp.length === 0) {
        continue;
      }

      const f: Point[][] = [];
      for (let j = 0; j < finalNfp.length; j++) {
        f.push(scalePolygon(finalNfp[j], config.clipperScale));
      }
      
      let minarea: number | null = null;
      let minx: number | null = null;
      let shiftvector: Placement;

      for (let j = 0; j < f.length; j++) {
        const nf = f[j];
        if (Math.abs(GeometryUtil.polygonArea(nf)) < 2) {
          continue;
        }

        for (let k = 0; k < nf.length; k++) {
          const allpoints: Point[] = [];
          for (let m = 0; m < placed.length; m++) {
            for (let n = 0; n < placed[m].length; n++) {
              allpoints.push({ X: placed[m][n].X + placements[m].x, Y: placed[m][n].Y + placements[m].y });
            }
          }

          shiftvector = {
            x: nf[k].X - path[0].X,
            y: nf[k].Y - path[0].Y,
            id: path.id!,
            rotation: path.rotation!,
            nfp: combinedNfp
          };

          for (let m = 0; m < path.length; m++) {
            allpoints.push({ X: path[m].X + shiftvector.x, Y: path[m].Y + shiftvector.y });
          }

          const rectbounds = GeometryUtil.getPolygonBounds(allpoints);
          if (rectbounds) {
            const area = rectbounds.width * 2 + rectbounds.height;

            if (minarea === null || area < minarea || (GeometryUtil.almostEqual(minarea, area) && (minx === null || shiftvector.x < minx))) {
              minarea = area;
              minwidth = rectbounds.width;
              position = shiftvector;
              minx = shiftvector.x;
            }
          }
        }
      }
      if (position) {
        placed.push(path);
        placements.push(position);
      }
    }

    if (minwidth) {
      fitness += minwidth / binarea;
    }

    for (let i = 0; i < placed.length; i++) {
      const index = pathsToPlace.indexOf(placed[i]);
      if (index >= 0) {
        pathsToPlace.splice(index, 1);
      }
    }

    if (placements && placements.length > 0) {
      allplacements.push(placements);
    }
    else {
      break;
    }
  }

  fitness += 2 * pathsToPlace.length;

  return { placements: allplacements, fitness: fitness, paths: pathsToPlace, area: binarea };
}
