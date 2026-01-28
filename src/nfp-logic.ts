import ClipperLib from 'js-clipper';
import GeometryUtil from './util/geometry.js';
import { Point, Polygon } from './types.js';



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

function rotatePolygon(polygon: Polygon, angle: number): Polygon {
    const rotated = [] as unknown as Polygon;
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (let i = 0; i < polygon.length; i++) {
        const x = polygon[i].X;
        const y = polygon[i].Y;
        const x1 = x * cos - y * sin;
        const y1 = x * sin + y * cos;

        rotated.push({ X: x1, Y: y1 });
    }
    
    const bounds = GeometryUtil.getPolygonBounds(rotated);
    if (bounds) {
        rotated.x = bounds.x;
        rotated.y = bounds.y;
        rotated.width = bounds.width;
        rotated.height = bounds.height;
    }
    
    if (polygon.children) {
        rotated.children = [];
        for (let i = 0; i < polygon.children.length; i++) {
            rotated.children.push(rotatePolygon(polygon.children[i], angle));
        }
    }

    return rotated;
}

function minkowskiDifference(A: Polygon, B: Polygon): Point[][] {
    const Ac = clonePolygon(A);
    ClipperLib.JS.ScaleUpPath(Ac, 10000000);
    const Bc = clonePolygon(B);
    ClipperLib.JS.ScaleUpPath(Bc, 10000000);
    for (let i = 0; i < Bc.length; i++) {
        Bc[i].X *= -1;
        Bc[i].Y *= -1;
    }
    const solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
    let clipperNfp: Point[] = [];

    let largestArea: number | null = null;
    for (let i = 0; i < solution.length; i++) {
        const n: Point[] = [];
        for (let j = 0; j < solution[i].length; j++) {
            n.push({ X: solution[i][j].X / 10000000, Y: solution[i][j].Y / 10000000 });
        }
        const sarea = GeometryUtil.polygonArea(n);
        if (largestArea === null || largestArea > sarea) {
            clipperNfp = n;
            largestArea = sarea;
        }
    }

    for (let i = 0; i < clipperNfp.length; i++) {
        clipperNfp[i].X += B[0].X;
        clipperNfp[i].Y += B[0].Y;
    }

    return [clipperNfp];
}

interface NfpPair {
    A: Polygon;
    B: Polygon;
    key: {
        Arotation: number;
        Brotation: number;
        inside: boolean;
        A: number;
        B: number;
    };
}

export function calculateNFP({ pair, searchEdges, useHoles }: { pair: NfpPair; searchEdges: boolean; useHoles: boolean }): { key: any; value: Point[][] } | null {
    if (!pair) {
        return null;
    }

    const A = rotatePolygon(pair.A, pair.key.Arotation);
    const B = rotatePolygon(pair.B, pair.key.Brotation);

    let nfp: Point[][] | null;

    if (pair.key.inside) {
        if (GeometryUtil.isRectangle(A, 0.001)) {
            nfp = GeometryUtil.noFitPolygonRectangle(A, B);
        }
        else {
            nfp = GeometryUtil.noFitPolygon(A, B, true, searchEdges);
        }

        if (nfp && nfp.length > 0) {
            for (let i = 0; i < nfp.length; i++) {
                if (GeometryUtil.polygonArea(nfp[i]) > 0) {
                    nfp[i].reverse();
                }
            }
        }
    }
    else {
        if (searchEdges) {
            nfp = GeometryUtil.noFitPolygon(A, B, false, searchEdges);
        }
        else {
            nfp = minkowskiDifference(A, B);
        }
        
        if (!nfp || nfp.length === 0) {
            return null;
        }

        for (let i = 0; i < nfp.length; i++) {
            if (!searchEdges || i === 0) {
                if (Math.abs(GeometryUtil.polygonArea(nfp[i])) < Math.abs(GeometryUtil.polygonArea(A))) {
                    nfp.splice(i, 1);
                    return null;
                }
            }
        }

        if (nfp.length === 0) {
            return null;
        }

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

        if (useHoles && A.children && A.children.length > 0) {
            const Bbounds = GeometryUtil.getPolygonBounds(B);

            if (Bbounds) {
                for (let i = 0; i < A.children.length; i++) {
                    const Abounds = GeometryUtil.getPolygonBounds(A.children[i]);

                    if (Abounds && Abounds.width > Bbounds.width && Abounds.height > Bbounds.height) {
                        const cnfp = GeometryUtil.noFitPolygon(A.children[i], B, true, searchEdges);
                        if (cnfp && cnfp.length > 0) {
                            for (let j = 0; j < cnfp.length; j++) {
                                if (GeometryUtil.polygonArea(cnfp[j]) < 0) {
                                    cnfp[j].reverse();
                                }
                                nfp!.push(cnfp[j]);
                            }
                        }
                    }
                }
            }
        }
    }

    return { key: pair.key, value: nfp! };
}
