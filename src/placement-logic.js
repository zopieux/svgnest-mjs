import ClipperLib from './util/clipper.js';
import GeometryUtil from './util/geometry.js';

function toClipperCoordinates(polygon) {
  const clone = [];
  for (let i = 0; i < polygon.length; i++) {
    clone.push({
      X: polygon[i].x,
      Y: polygon[i].y
    });
  }

  return clone;
};

function toNestCoordinates(polygon, scale) {
  const clone = [];
  for (let i = 0; i < polygon.length; i++) {
    clone.push({
      x: polygon[i].X / scale,
      y: polygon[i].Y / scale
    });
  }

  return clone;
};

function rotatePolygon(polygon, degrees) {
  const rotated = [];
  const angle = degrees * Math.PI / 180;
  for (let i = 0; i < polygon.length; i++) {
    const x = polygon[i].x;
    const y = polygon[i].y;
    const x1 = x * Math.cos(angle) - y * Math.sin(angle);
    const y1 = x * Math.sin(angle) + y * Math.cos(angle);

    rotated.push({ x: x1, y: y1 });
  }

  if (polygon.children && polygon.children.length > 0) {
    rotated.children = [];
    for (let j = 0; j < polygon.children.length; j++) {
      rotated.children.push(rotatePolygon(polygon.children[j], degrees));
    }
  }

  return rotated;
};

export function placePaths({ binPolygon, paths, ids, rotations, config, nfpCache }) {

  if (!binPolygon) {
    return null;
  }

  let path;

  // rotate paths by given rotation
  const rotated = [];
  for (let i = 0; i < paths.length; i++) {
    const r = rotatePolygon(paths[i], rotations[i]);
    r.rotation = rotations[i];
    r.source = paths[i].source;
    r.id = ids[i];
    rotated.push(r);
  }

  paths = rotated;

  const allplacements = [];
  let fitness = 0;
  const binarea = Math.abs(GeometryUtil.polygonArea(binPolygon));
  let key, nfp;

  while (paths.length > 0) {

    const placed = [];
    const placements = [];
    fitness += 1; // add 1 for each new bin opened (lower fitness is better)
    let minwidth = null;

    for (let i = 0; i < paths.length; i++) {
      path = paths[i];
      minwidth = null;

      // inner NFP
      key = JSON.stringify({ A: -1, B: path.id, inside: true, Arotation: 0, Brotation: path.rotation });
      const binNfp = nfpCache[key];

      // part unplaceable, skip
      if (!binNfp || binNfp.length == 0) {
        continue;
      }

      // ensure all necessary NFPs exist
      let error = false;
      for (let j = 0; j < placed.length; j++) {
        key = JSON.stringify({ A: placed[j].id, B: path.id, inside: false, Arotation: placed[j].rotation, Brotation: path.rotation });
        nfp = nfpCache[key];

        if (!nfp) {
          error = true;
          break;
        }
      }

      // part unplaceable, skip
      if (error) {
        continue;
      }

      let position = null;
      if (placed.length == 0) {
        // first placement, put it on the left
        for (let j = 0; j < binNfp.length; j++) {
          for (let k = 0; k < binNfp[j].length; k++) {
            if (position === null || binNfp[j][k].x - path[0].x < position.x) {
              position = {
                x: binNfp[j][k].x - path[0].x,
                y: binNfp[j][k].y - path[0].y,
                id: path.id,
                rotation: path.rotation
              }
            }
          }
        }

        placements.push(position);
        placed.push(path);

        continue;
      }

      const clipperBinNfp = [];
      for (let j = 0; j < binNfp.length; j++) {
        clipperBinNfp.push(toClipperCoordinates(binNfp[j]));
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
          let clone = toClipperCoordinates(nfp[k]);
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

      // difference with bin polygon
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

      if (!finalNfp || finalNfp.length == 0) {
        continue;
      }

      const f = [];
      for (let j = 0; j < finalNfp.length; j++) {
        // back to normal scale
        f.push(toNestCoordinates(finalNfp[j], config.clipperScale));
      }
      finalNfp = f;

      // choose placement that results in the smallest bounding box
      // could use convex hull instead, but it can create oddly shaped nests (triangles or long slivers) which are not optimal for real-world use
      // todo: generalize gravity direction
      // let minwidth = null;
      let minarea = null;
      let minx = null;
      let nf, area, shiftvector;

      for (let j = 0; j < finalNfp.length; j++) {
        nf = finalNfp[j];
        if (Math.abs(GeometryUtil.polygonArea(nf)) < 2) {
          continue;
        }

        for (let k = 0; k < nf.length; k++) {
          const allpoints = [];
          for (let m = 0; m < placed.length; m++) {
            for (let n = 0; n < placed[m].length; n++) {
              allpoints.push({ x: placed[m][n].x + placements[m].x, y: placed[m][n].y + placements[m].y });
            }
          }

          shiftvector = {
            x: nf[k].x - path[0].x,
            y: nf[k].y - path[0].y,
            id: path.id,
            rotation: path.rotation,
            nfp: combinedNfp
          };

          for (let m = 0; m < path.length; m++) {
            allpoints.push({ x: path[m].x + shiftvector.x, y: path[m].y + shiftvector.y });
          }

          const rectbounds = GeometryUtil.getPolygonBounds(allpoints);

          // weigh width more, to help compress in direction of gravity
          area = rectbounds.width * 2 + rectbounds.height;

          if (minarea === null || area < minarea || (GeometryUtil.almostEqual(minarea, area) && (minx === null || shiftvector.x < minx))) {
            minarea = area;
            minwidth = rectbounds.width;
            position = shiftvector;
            minx = shiftvector.x;
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
      const index = paths.indexOf(placed[i]);
      if (index >= 0) {
        paths.splice(index, 1);
      }
    }

    if (placements && placements.length > 0) {
      allplacements.push(placements);
    }
    else {
      break; // something went wrong
    }
  }

  // there were parts that couldn't be placed
  fitness += 2 * paths.length;

  return { placements: allplacements, fitness: fitness, paths: paths, area: binarea };
}