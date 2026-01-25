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

function rotatePolygon(polygon, angle) {
    const rotated = [];
    angle = angle * Math.PI / 180;
    for (let i = 0; i < polygon.length; i++) {
        const x = polygon[i].x;
        const y = polygon[i].y;
        const x1 = x * Math.cos(angle) - y * Math.sin(angle);
        const y1 = x * Math.sin(angle) + y * Math.cos(angle);

        rotated.push({ x: x1, y: y1 });
    }
    // reset bounding box
    const bounds = GeometryUtil.getPolygonBounds(rotated);
    rotated.x = bounds.x;
    rotated.y = bounds.y;
    rotated.width = bounds.width;
    rotated.height = bounds.height;
    
    // Maintain child nodes if any (holes)
    if(polygon.children){
        rotated.children = [];
        for(let i=0; i<polygon.children.length; i++){
            rotated.children.push(rotatePolygon(polygon.children[i], angle));
        }
    }

    return rotated;
}

function minkowskiDifference(A, B) {
    const Ac = toClipperCoordinates(A);
    ClipperLib.JS.ScaleUpPath(Ac, 10000000);
    const Bc = toClipperCoordinates(B);
    ClipperLib.JS.ScaleUpPath(Bc, 10000000);
    for (let i = 0; i < Bc.length; i++) {
        Bc[i].X *= -1;
        Bc[i].Y *= -1;
    }
    const solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
    let clipperNfp;

    let largestArea = null;
    for (let i = 0; i < solution.length; i++) {
        const n = toNestCoordinates(solution[i], 10000000);
        const sarea = GeometryUtil.polygonArea(n);
        if (largestArea === null || largestArea > sarea) {
            clipperNfp = n;
            largestArea = sarea;
        }
    }

    for (let i = 0; i < clipperNfp.length; i++) {
        clipperNfp[i].x += B[0].x;
        clipperNfp[i].y += B[0].y;
    }

    return [clipperNfp];
}

export function calculateNFP({ pair, searchEdges, useHoles }) {
    if (!pair || pair.length == 0) {
        return null;
    }

    const A = rotatePolygon(pair.A, pair.key.Arotation);
    const B = rotatePolygon(pair.B, pair.key.Brotation);

    let nfp;

    if (pair.key.inside) {
        if (GeometryUtil.isRectangle(A, 0.001)) {
            nfp = GeometryUtil.noFitPolygonRectangle(A, B);
        }
        else {
            nfp = GeometryUtil.noFitPolygon(A, B, true, searchEdges);
        }

        // ensure all interior NFPs have the same winding direction
        if (nfp && nfp.length > 0) {
            for (let i = 0; i < nfp.length; i++) {
                if (GeometryUtil.polygonArea(nfp[i]) > 0) {
                    nfp[i].reverse();
                }
            }
        }
        else {
            // warning on null inner NFP
            // this is not an error, as the part may simply be larger than the bin or otherwise unplaceable due to geometry
            // log('NFP Warning: ', pair.key);
        }
    }
    else {
        if (searchEdges) {
            nfp = GeometryUtil.noFitPolygon(A, B, false, searchEdges);
        }
        else {
            nfp = minkowskiDifference(A, B);
        }
        // sanity check
        if (!nfp || nfp.length == 0) {
            // log('NFP Error: ', pair.key);
            return null;
        }

        for (let i = 0; i < nfp.length; i++) {
            if (!searchEdges || i == 0) { // if searchedges is active, only the first NFP is guaranteed to pass sanity check
                if (Math.abs(GeometryUtil.polygonArea(nfp[i])) < Math.abs(GeometryUtil.polygonArea(A))) {
                    // log('NFP Area Error: ', Math.abs(GeometryUtil.polygonArea(nfp[i])), pair.key);
                    nfp.splice(i, 1);
                    return null;
                }
            }
        }

        if (nfp.length == 0) {
            return null;
        }

        // for outer NFPs, the first is guaranteed to be the largest. Any subsequent NFPs that lie inside the first are holes
        for (let i = 0; i < nfp.length; i++) {
            if (GeometryUtil.polygonArea(nfp[i]) > 0) {
                nfp[i].reverse();
            }

            if (i > 0) {
                if (GeometryUtil.pointInPolygon(nfp[i][0], nfp[0])) {
                    if (GeometryUtil.polygonArea(nfp[i]) < 0) {
                        nfp[i].reverse();
                    }
                }
            }
        }

        // generate nfps for children (holes of parts) if any exist
        if (useHoles && A.children && A.children.length > 0) {
            const Bbounds = GeometryUtil.getPolygonBounds(B);

            for (let i = 0; i < A.children.length; i++) {
                const Abounds = GeometryUtil.getPolygonBounds(A.children[i]);

                // no need to find nfp if B's bounding box is too big
                if (Abounds.width > Bbounds.width && Abounds.height > Bbounds.height) {

                    const cnfp = GeometryUtil.noFitPolygon(A.children[i], B, true, searchEdges);
                    // ensure all interior NFPs have the same winding direction
                    if (cnfp && cnfp.length > 0) {
                        for (let j = 0; j < cnfp.length; j++) {
                            if (GeometryUtil.polygonArea(cnfp[j]) < 0) {
                                cnfp[j].reverse();
                            }
                            nfp.push(cnfp[j]);
                        }
                    }

                }
            }
        }
    }

    return { key: pair.key, value: nfp };
}