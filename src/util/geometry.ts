import { Point, Polygon } from '../types.js';

// floating point comparison tolerance
const TOL = Math.pow(10, -9);

function _almostEqual(a: number, b: number, tolerance?: number): boolean {
  if (tolerance === undefined) {
    tolerance = TOL;
  }
  return Math.abs(a - b) < tolerance;
}

function _withinDistance(p1: Point, p2: Point, distance: number): boolean {
  const dx = p1.X - p2.X;
  const dy = p1.Y - p2.Y;
  return ((dx * dx + dy * dy) < distance * distance);
}

function _degreesToRadians(angle: number): number {
  return angle * (Math.PI / 180);
}

function _radiansToDegrees(angle: number): number {
  return angle * (180 / Math.PI);
}

function _normalizeVector(v: Point): Point {
  if (_almostEqual(v.X * v.X + v.Y * v.Y, 1)) {
    return v;
  }
  const len = Math.sqrt(v.X * v.X + v.Y * v.Y);
  const inverse = 1 / len;

  return {
    X: v.X * inverse,
    Y: v.Y * inverse
  };
}

function _onSegment(A: Point, B: Point, p: Point): boolean {
  if (_almostEqual(A.X, B.X) && _almostEqual(p.X, A.X)) {
    if (!_almostEqual(p.Y, B.Y) && !_almostEqual(p.Y, A.Y) && p.Y < Math.max(B.Y, A.Y) && p.Y > Math.min(B.Y, A.Y)) {
      return true;
    }
    else {
      return false;
    }
  }

  if (_almostEqual(A.Y, B.Y) && _almostEqual(p.Y, A.Y)) {
    if (!_almostEqual(p.X, B.X) && !_almostEqual(p.X, A.X) && p.X < Math.max(B.X, A.X) && p.X > Math.min(B.X, A.X)) {
      return true;
    }
    else {
      return false;
    }
  }

  if ((p.X < A.X && p.X < B.X) || (p.X > A.X && p.X > B.X) || (p.Y < A.Y && p.Y < B.Y) || (p.Y > A.Y && p.Y > B.Y)) {
    return false;
  }

  if ((_almostEqual(p.X, A.X) && _almostEqual(p.Y, A.Y)) || (_almostEqual(p.X, B.X) && _almostEqual(p.Y, B.Y))) {
    return false;
  }

  const cross = (p.Y - A.Y) * (B.X - A.X) - (p.X - A.X) * (B.Y - A.Y);

  if (Math.abs(cross) > TOL) {
    return false;
  }

  const dot = (p.X - A.X) * (B.X - A.X) + (p.Y - A.Y) * (B.Y - A.Y);

  if (dot < 0 || _almostEqual(dot, 0)) {
    return false;
  }

  const len2 = (B.X - A.X) * (B.X - A.X) + (B.Y - A.Y) * (B.Y - A.Y);

  if (dot > len2 || _almostEqual(dot, len2)) {
    return false;
  }

  return true;
}

function _lineIntersect(A: Point, B: Point, E: Point, F: Point, infinite?: boolean): Point | null {
  const a1 = B.Y - A.Y;
  const b1 = A.X - B.X;
  const c1 = B.X * A.Y - A.X * B.Y;
  const a2 = F.Y - E.Y;
  const b2 = E.X - F.X;
  const c2 = F.X * E.Y - E.X * F.Y;

  const denom = a1 * b2 - a2 * b1;

  if (_almostEqual(denom, 0)) {
    return null;
  }

  const x = (b1 * c2 - b2 * c1) / denom;
  const y = (a2 * c1 - a1 * c2) / denom;

  if (!isFinite(x) || !isFinite(y)) {
    return null;
  }

  if (!infinite) {
    if (Math.abs(A.X - B.X) > TOL && ((A.X < B.X) ? x < A.X || x > B.X : x > A.X || x < B.X)) return null;
    if (Math.abs(A.Y - B.Y) > TOL && ((A.Y < B.Y) ? y < A.Y || y > B.Y : y > A.Y || y < B.Y)) return null;

    if (Math.abs(E.X - F.X) > TOL && ((E.X < F.X) ? x < E.X || x > F.X : x > E.X || x < F.X)) return null;
    if (Math.abs(E.Y - F.Y) > TOL && ((E.Y < F.Y) ? y < E.Y || y > F.Y : y > E.Y || y < F.Y)) return null;
  }

  return { X: x, Y: y };
}

export const QuadraticBezier = {
  isFlat: function (p1: Point, p2: Point, c1: Point, tol: number): boolean {
    tol = 4 * tol * tol;

    let ux = 2 * c1.X - p1.X - p2.X;
    ux *= ux;

    let uy = 2 * c1.Y - p1.Y - p2.Y;
    uy *= uy;

    return (ux + uy <= tol);
  },

  linearize: function (p1: Point, p2: Point, c1: Point, tol: number): Point[] {
    const finished: Point[] = [p1];
    const todo: { p1: Point; p2: Point; c1: Point }[] = [{ p1: p1, p2: p2, c1: c1 }];

    while (todo.length > 0) {
      const segment = todo[0];

      if (this.isFlat(segment.p1, segment.p2, segment.c1, tol)) {
        finished.push({ X: segment.p2.X, Y: segment.p2.Y });
        todo.shift();
      }
      else {
        const divided = this.subdivide(segment.p1, segment.p2, segment.c1, 0.5);
        todo.splice(0, 1, divided[0], divided[1]);
      }
    }
    return finished;
  },

  subdivide: function (p1: Point, p2: Point, c1: Point, t: number): [{ p1: Point; p2: Point; c1: Point }, { p1: Point; p2: Point; c1: Point }] {
    const mid1 = {
      X: p1.X + (c1.X - p1.X) * t,
      Y: p1.Y + (c1.Y - p1.Y) * t
    };

    const mid2 = {
      X: c1.X + (p2.X - c1.X) * t,
      Y: c1.Y + (p2.Y - c1.Y) * t
    };

    const mid3 = {
      X: mid1.X + (mid2.X - mid1.X) * t,
      Y: mid1.Y + (mid2.Y - mid1.Y) * t
    };

    const seg1 = { p1: p1, p2: mid3, c1: mid1 };
    const seg2 = { p1: mid3, p2: p2, c1: mid2 };

    return [seg1, seg2];
  }
};

export const CubicBezier = {
  isFlat: function (p1: Point, p2: Point, c1: Point, c2: Point, tol: number): boolean {
    tol = 16 * tol * tol;

    let ux = 3 * c1.X - 2 * p1.X - p2.X;
    ux *= ux;

    let uy = 3 * c1.Y - 2 * p1.Y - p2.Y;
    uy *= uy;

    let vx = 3 * c2.X - 2 * p2.X - p1.X;
    vx *= vx;

    let vy = 3 * c2.Y - 2 * p2.Y - p1.Y;
    vy *= vy;

    if (ux < vx) {
      ux = vx;
    }
    if (uy < vy) {
      uy = vy;
    }

    return (ux + uy <= tol);
  },

  linearize: function (p1: Point, p2: Point, c1: Point, c2: Point, tol: number): Point[] {
    const finished: Point[] = [p1];
    const todo: { p1: Point; p2: Point; c1: Point; c2: Point }[] = [{ p1: p1, p2: p2, c1: c1, c2: c2 }];

    while (todo.length > 0) {
      const segment = todo[0];

      if (this.isFlat(segment.p1, segment.p2, segment.c1, segment.c2, tol)) {
        finished.push({ X: segment.p2.X, Y: segment.p2.Y });
        todo.shift();
      }
      else {
        const divided = this.subdivide(segment.p1, segment.p2, segment.c1, segment.c2, 0.5);
        todo.splice(0, 1, divided[0], divided[1]);
      }
    }
    return finished;
  },

  subdivide: function (p1: Point, p2: Point, c1: Point, c2: Point, t: number): [{ p1: Point; p2: Point; c1: Point; c2: Point }, { p1: Point; p2: Point; c1: Point; c2: Point }] {
    const mid1 = {
      X: p1.X + (c1.X - p1.X) * t,
      Y: p1.Y + (c1.Y - p1.Y) * t
    };

    const mid2 = {
      X: c2.X + (p2.X - c2.X) * t,
      Y: c2.Y + (p2.Y - c2.Y) * t
    };

    const mid3 = {
      X: c1.X + (c2.X - c1.X) * t,
      Y: c1.Y + (c2.Y - c1.Y) * t
    };

    const mida = {
      X: mid1.X + (mid3.X - mid1.X) * t,
      Y: mid1.Y + (mid3.Y - mid1.Y) * t
    };

    const midb = {
      X: mid3.X + (mid2.X - mid3.X) * t,
      Y: mid3.Y + (mid2.Y - mid3.Y) * t
    };

    const midx = {
      X: mida.X + (midb.X - mida.X) * t,
      Y: mida.Y + (midb.Y - mida.Y) * t
    };

    const seg1 = { p1: p1, p2: midx, c1: mid1, c2: mida };
    const seg2 = { p1: midx, p2: p2, c1: midb, c2: mid2 };

    return [seg1, seg2];
  }
};

interface CenterArc {
  center: Point;
  rx: number;
  ry: number;
  theta: number;
  extent: number;
  angle: number;
}

export const Arc = {
  linearize: function (p1: Point, p2: Point, rx: number, ry: number, angle: number, largearc: number, sweep: number, tol: number): Point[] {
    const finished: Point[] = [p2];
    let arc = this.svgToCenter(p1, p2, rx, ry, angle, largearc, sweep);
    const todo: CenterArc[] = [arc];

    while (todo.length > 0) {
      const currentArc = todo[0];

      const fullarc = this.centerToSvg(currentArc.center, currentArc.rx, currentArc.ry, currentArc.theta, currentArc.extent, currentArc.angle);
      const subarc = this.centerToSvg(currentArc.center, currentArc.rx, currentArc.ry, currentArc.theta, 0.5 * currentArc.extent, currentArc.angle);
      const arcmid = subarc.p2;

      const mid = {
        X: 0.5 * (fullarc.p1.X + fullarc.p2.X),
        Y: 0.5 * (fullarc.p1.Y + fullarc.p2.Y)
      };

      if (_withinDistance(mid, arcmid, tol)) {
        finished.unshift(fullarc.p2);
        todo.shift();
      }
      else {
        const arc1: CenterArc = {
          center: currentArc.center,
          rx: currentArc.rx,
          ry: currentArc.ry,
          theta: currentArc.theta,
          extent: 0.5 * currentArc.extent,
          angle: currentArc.angle
        };
        const arc2: CenterArc = {
          center: currentArc.center,
          rx: currentArc.rx,
          ry: currentArc.ry,
          theta: currentArc.theta + 0.5 * currentArc.extent,
          extent: 0.5 * currentArc.extent,
          angle: currentArc.angle
        };
        todo.splice(0, 1, arc1, arc2);
      }
    }
    return finished;
  },

  centerToSvg: function (center: Point, rx: number, ry: number, theta1: number, extent: number, angleDegrees: number) {
    const theta2 = theta1 + extent;
    const radTheta1 = _degreesToRadians(theta1);
    const radTheta2 = _degreesToRadians(theta2);
    const angle = _degreesToRadians(angleDegrees);

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const t1cos = Math.cos(radTheta1);
    const t1sin = Math.sin(radTheta1);

    const t2cos = Math.cos(radTheta2);
    const t2sin = Math.sin(radTheta2);

    const x0 = center.X + cos * rx * t1cos + (-sin) * ry * t1sin;
    const y0 = center.Y + sin * rx * t1cos + cos * ry * t1sin;

    const x1 = center.X + cos * rx * t2cos + (-sin) * ry * t2sin;
    const y1 = center.Y + sin * rx * t2cos + cos * ry * t2sin;

    const largearc = (extent > 180) ? 1 : 0;
    const sweep = (extent > 0) ? 1 : 0;

    return {
      p1: { X: x0, Y: y0 },
      p2: { X: x1, Y: y1 },
      rx: rx,
      ry: ry,
      angle: angle,
      largearc: largearc,
      sweep: sweep
    };
  },

  svgToCenter: function (p1: Point, p2: Point, rx: number, ry: number, angleDegrees: number, largearc: number, sweep: number): CenterArc {
    const mid = {
      X: 0.5 * (p1.X + p2.X),
      Y: 0.5 * (p1.Y + p2.Y)
    };

    const diff = {
      X: 0.5 * (p2.X - p1.X),
      Y: 0.5 * (p2.Y - p1.Y)
    };

    const angle = _degreesToRadians(angleDegrees % 360);

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const x1 = cos * diff.X + sin * diff.Y;
    const y1 = -sin * diff.X + cos * diff.Y;

    rx = Math.abs(rx);
    ry = Math.abs(ry);
    let Prx = rx * rx;
    let Pry = ry * ry;
    const Px1 = x1 * x1;
    const Py1 = y1 * y1;

    const radiiCheck = Px1 / Prx + Py1 / Pry;
    if (radiiCheck > 1) {
      const radiiSqrt = Math.sqrt(radiiCheck);
      rx = radiiSqrt * rx;
      ry = radiiSqrt * ry;
      Prx = rx * rx;
      Pry = ry * ry;
    }

    let sign = (largearc != sweep) ? -1 : 1;
    let sq = ((Prx * Pry) - (Prx * Py1) - (Pry * Px1)) / ((Prx * Py1) + (Pry * Px1));

    sq = (sq < 0) ? 0 : sq;

    const coef = sign * Math.sqrt(sq);
    const cx1 = coef * ((rx * y1) / ry);
    const cy1 = coef * -((ry * x1) / rx);

    const cx = mid.X + (cos * cx1 - sin * cy1);
    const cy = mid.Y + (sin * cx1 + cos * cy1);

    const ux = (x1 - cx1) / rx;
    const uy = (y1 - cy1) / ry;
    const vx = (-x1 - cx1) / rx;
    const vy = (-y1 - cy1) / ry;
    let n = Math.sqrt((ux * ux) + (uy * uy));
    let p = ux;
    sign = (uy < 0) ? -1 : 1;

    let theta = sign * Math.acos(p / n);
    theta = _radiansToDegrees(theta);

    n = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    p = ux * vx + uy * vy;
    sign = ((ux * vy - uy * vx) < 0) ? -1 : 1;
    let delta = sign * Math.acos(p / n);
    delta = _radiansToDegrees(delta);

    if (sweep == 1 && delta > 0) {
      delta -= 360;
    }
    else if (sweep == 0 && delta < 0) {
      delta += 360;
    }

    delta %= 360;
    theta %= 360;

    return {
      center: { X: cx, Y: cy },
      rx: rx,
      ry: ry,
      theta: theta,
      extent: delta,
      angle: angleDegrees
    };
  }
};

export const GeometryUtil = {
  withinDistance: _withinDistance,
  lineIntersect: _lineIntersect,
  almostEqual: _almostEqual,
  QuadraticBezier: QuadraticBezier,
  CubicBezier: CubicBezier,
  Arc: Arc,

  getPolygonBounds: function (polygon: Point[]) {
    if (!polygon || polygon.length < 3) {
      return null;
    }

    let xmin = polygon[0].X;
    let xmax = polygon[0].X;
    let ymin = polygon[0].Y;
    let ymax = polygon[0].Y;

    for (let i = 1; i < polygon.length; i++) {
      if (polygon[i].X > xmax) {
        xmax = polygon[i].X;
      }
      else if (polygon[i].X < xmin) {
        xmin = polygon[i].X;
      }

      if (polygon[i].Y > ymax) {
        ymax = polygon[i].Y;
      }
      else if (polygon[i].Y < ymin) {
        ymin = polygon[i].Y;
      }
    }

    return {
      x: xmin,
      y: ymin,
      width: xmax - xmin,
      height: ymax - ymin
    };
  },

  pointInPolygon: function (point: Point, polygon: Polygon): boolean | null {
    if (!polygon || polygon.length < 3) {
      return null;
    }

    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].X;
      const yi = polygon[i].Y;
      const xj = polygon[j].X;
      const yj = polygon[j].Y;

      if (_almostEqual(xi, point.X) && _almostEqual(yi, point.Y)) {
        return null;
      }

      if (_onSegment({ X: xi, Y: yi }, { X: xj, Y: yj }, point)) {
        return null;
      }

      if (_almostEqual(xi, xj) && _almostEqual(yi, yj)) {
        continue;
      }

      const intersect = ((yi > point.Y) != (yj > point.Y)) && (point.X < (xj - xi) * (point.Y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }

    return inside;
  },

  polygonArea: function (polygon: Point[]): number {
    let area = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      area += (polygon[j].X + polygon[i].X) * (polygon[j].Y - polygon[i].Y);
    }
    return 0.5 * area;
  },

  intersect: function (A: Polygon, B: Polygon): boolean {

    A = A.slice(0) as Polygon;
    B = B.slice(0) as Polygon;

    for (let i = 0; i < A.length - 1; i++) {
      for (let j = 0; j < B.length - 1; j++) {
        const a1 = { X: A[i].X, Y: A[i].Y };
        const a2 = { X: A[i + 1].X, Y: A[i + 1].Y };
        const b1 = { X: B[j].X, Y: B[j].Y };
        const b2 = { X: B[j + 1].X, Y: B[j + 1].Y };

        let prevbindex = (j == 0) ? B.length - 1 : j - 1;
        let prevaindex = (i == 0) ? A.length - 1 : i - 1;
        let nextbindex = (j + 1 == B.length - 1) ? 0 : j + 2;
        let nextaindex = (i + 1 == A.length - 1) ? 0 : i + 2;

        if (B[prevbindex] == B[j] || (_almostEqual(B[prevbindex].X, B[j].X) && _almostEqual(B[prevbindex].Y, B[j].Y))) {
          prevbindex = (prevbindex == 0) ? B.length - 1 : prevbindex - 1;
        }

        if (A[prevaindex] == A[i] || (_almostEqual(A[prevaindex].X, A[i].X) && _almostEqual(A[prevaindex].Y, A[i].Y))) {
          prevaindex = (prevaindex == 0) ? A.length - 1 : prevaindex - 1;
        }

        if (B[nextbindex] == B[j + 1] || (_almostEqual(B[nextbindex].X, B[j + 1].X) && _almostEqual(B[nextbindex].Y, B[j + 1].Y))) {
          nextbindex = (nextbindex == B.length - 1) ? 0 : nextbindex + 1;
        }

        if (A[nextaindex] == A[i + 1] || (_almostEqual(A[nextaindex].X, A[i + 1].X) && _almostEqual(A[nextaindex].Y, A[i + 1].Y))) {
          nextaindex = (nextaindex == A.length - 1) ? 0 : nextaindex + 1;
        }

        const a0 = { X: A[prevaindex].X, Y: A[prevaindex].Y };
        const b0 = { X: B[prevbindex].X, Y: B[prevbindex].Y };

        const a3 = { X: A[nextaindex].X, Y: A[nextaindex].Y };
        const b3 = { X: B[nextbindex].X, Y: B[nextbindex].Y };

        if (_onSegment(a1, a2, b1) || (_almostEqual(a1.X, b1.X) && _almostEqual(a1.Y, b1.Y))) {
          const b0in = this.pointInPolygon(b0, A);
          const b2in = this.pointInPolygon(b2, A);
          if ((b0in === true && b2in === false) || (b0in === false && b2in === true)) {
            return true;
          }
          continue;
        }

        if (_onSegment(a1, a2, b2) || (_almostEqual(a2.X, b2.X) && _almostEqual(a2.Y, b2.Y))) {
          const b1in = this.pointInPolygon(b1, A);
          const b3in = this.pointInPolygon(b3, A);
          if ((b1in === true && b3in === false) || (b1in === false && b3in === true)) {
            return true;
          }
          continue;
        }

        if (_onSegment(b1, b2, a1) || (_almostEqual(a1.X, b2.X) && _almostEqual(a1.Y, b2.Y))) {
          const a0in = this.pointInPolygon(a0, B);
          const a2in = this.pointInPolygon(a2, B);
          if ((a0in === true && a2in === false) || (a0in === false && a2in === true)) {
            return true;
          }
          continue;
        }

        if (_onSegment(b1, b2, a2) || (_almostEqual(a2.X, b1.X) && _almostEqual(a2.Y, b1.Y))) {
          const a1in = this.pointInPolygon(a1, B);
          const a3in = this.pointInPolygon(a3, B);
          if ((a1in === true && a3in === false) || (a1in === false && a3in === true)) {
            return true;
          }
          continue;
        }

        const p = _lineIntersect(b1, b2, a1, a2);
        if (p !== null) {
          return true;
        }
      }
    }

    return false;
  },

  polygonEdge: function (polygon: Point[], normal: Point): Point[] | null {
    if (!polygon || polygon.length < 3) {
      return null;
    }

    normal = _normalizeVector(normal);

    const direction = {
      X: -normal.Y,
      Y: normal.X
    };

    let min: number | null = null;
    let max: number | null = null;

    const dotproduct: number[] = [];

    for (let i = 0; i < polygon.length; i++) {
      const dot = polygon[i].X * direction.X + polygon[i].Y * direction.Y;
      dotproduct.push(dot);
      if (min === null || dot < min) {
        min = dot;
      }
      if (max === null || dot > max) {
        max = dot;
      }
    }

    let indexmin = 0;
    let indexmax = 0;

    let normalmin: number | null = null;
    let normalmax: number | null = null;

    for (let i = 0; i < polygon.length; i++) {
      if (min !== null && _almostEqual(dotproduct[i], min)) {
        const dot = polygon[i].X * normal.X + polygon[i].Y * normal.Y;
        if (normalmin === null || dot > normalmin) {
          normalmin = dot;
          indexmin = i;
        }
      }
      else if (max !== null && _almostEqual(dotproduct[i], max)) {
        const dot = polygon[i].X * normal.X + polygon[i].Y * normal.Y;
        if (normalmax === null || dot > normalmax) {
          normalmax = dot;
          indexmax = i;
        }
      }
    }

    let indexleft = indexmin - 1;
    let indexright = indexmin + 1;

    if (indexleft < 0) {
      indexleft = polygon.length - 1;
    }
    if (indexright >= polygon.length) {
      indexright = 0;
    }

    const minvertex = polygon[indexmin];
    const left = polygon[indexleft];
    const right = polygon[indexright];

    const leftvector = {
      X: left.X - minvertex.X,
      Y: left.Y - minvertex.Y
    };

    const rightvector = {
      X: right.X - minvertex.X,
      Y: right.Y - minvertex.Y
    };

    const dotleft = leftvector.X * direction.X + leftvector.Y * direction.Y;
    const dotright = rightvector.X * direction.X + rightvector.Y * direction.Y;

    let scandirection = -1;

    if (_almostEqual(dotleft, 0)) {
      scandirection = 1;
    }
    else if (_almostEqual(dotright, 0)) {
      scandirection = -1;
    }
    else {
      let normaldotleft;
      let normaldotright;

      if (_almostEqual(dotleft, dotright)) {
        normaldotleft = leftvector.X * normal.X + leftvector.Y * normal.Y;
        normaldotright = rightvector.X * normal.X + rightvector.Y * normal.Y;
      }
      else if (dotleft < dotright) {
        normaldotleft = leftvector.X * normal.X + leftvector.Y * normal.Y;
        normaldotright = (rightvector.X * normal.X + rightvector.Y * normal.Y) * (dotleft / dotright);
      }
      else {
        normaldotleft = (leftvector.X * normal.X + leftvector.Y * normal.Y) * (dotright / dotleft);
        normaldotright = rightvector.X * normal.X + rightvector.Y * normal.Y;
      }

      if (normaldotleft > normaldotright) {
        scandirection = -1;
      }
      else {
        scandirection = 1;
      }
    }

    // connect all points between indexmin and indexmax along the scan direction
    const edge: Point[] = [];
    let count = 0;
    let i = indexmin;
    while (count < polygon.length) {
      if (i >= polygon.length) {
        i = 0;
      }
      else if (i < 0) {
        i = polygon.length - 1;
      }

      edge.push(polygon[i]);

      if (i == indexmax) {
        break;
      }
      i += scandirection;
      count++;
    }

    return edge;
  },

  pointLineDistance: function (p: Point, s1: Point, s2: Point, normal: Point, s1inclusive?: boolean, s2inclusive?: boolean): number | null {
    normal = _normalizeVector(normal);

    const dir = {
      X: normal.Y,
      Y: -normal.X
    };

    const pdot = p.X * dir.X + p.Y * dir.Y;
    const s1dot = s1.X * dir.X + s1.Y * dir.Y;
    const s2dot = s2.X * dir.X + s2.Y * dir.Y;

    const pdotnorm = p.X * normal.X + p.Y * normal.Y;
    const s1dotnorm = s1.X * normal.X + s1.Y * normal.Y;
    const s2dotnorm = s2.X * normal.X + s2.Y * normal.Y;

    if (_almostEqual(pdot, s1dot) && _almostEqual(pdot, s2dot)) {
      if (_almostEqual(pdotnorm, s1dotnorm)) {
        return null;
      }

      if (_almostEqual(pdotnorm, s2dotnorm)) {
        return null;
      }

      if (pdotnorm > s1dotnorm && pdotnorm > s2dotnorm) {
        return Math.min(pdotnorm - s1dotnorm, pdotnorm - s2dotnorm);
      }
      if (pdotnorm < s1dotnorm && pdotnorm < s2dotnorm) {
        return -Math.min(s1dotnorm - pdotnorm, s2dotnorm - pdotnorm);
      }

      const diff1 = pdotnorm - s1dotnorm;
      const diff2 = pdotnorm - s2dotnorm;
      if (diff1 > 0) {
        return diff1;
      }
      else {
        return diff2;
      }
    }
    else if (_almostEqual(pdot, s1dot)) {
      if (s1inclusive) {
        return pdotnorm - s1dotnorm;
      }
      else {
        return null;
      }
    }
    else if (_almostEqual(pdot, s2dot)) {
      if (s2inclusive) {
        return pdotnorm - s2dotnorm;
      }
      else {
        return null;
      }
    }
    else if ((pdot < s1dot && pdot < s2dot) || (pdot > s1dot && pdot > s2dot)) {
      return null;
    }

    return (pdotnorm - s1dotnorm + (s1dotnorm - s2dotnorm) * (s1dot - pdot) / (s1dot - s2dot));
  },

  pointDistance: function (p: Point, s1: Point, s2: Point, normal: Point, infinite?: boolean): number | null {
    normal = _normalizeVector(normal);

    const dir = {
      X: normal.Y,
      Y: -normal.X
    };

    const pdot = p.X * dir.X + p.Y * dir.Y;
    const s1dot = s1.X * dir.X + s1.Y * dir.Y;
    const s2dot = s2.X * dir.X + s2.Y * dir.Y;

    const pdotnorm = p.X * normal.X + p.Y * normal.Y;
    const s1dotnorm = s1.X * normal.X + s1.Y * normal.Y;
    const s2dotnorm = s2.X * normal.X + s2.Y * normal.Y;

    if (!infinite) {
      if (((pdot < s1dot || _almostEqual(pdot, s1dot)) && (pdot < s2dot || _almostEqual(pdot, s2dot))) || ((pdot > s1dot || _almostEqual(pdot, s1dot)) && (pdot > s2dot || _almostEqual(pdot, s2dot)))) {
        return null;
      }
      if ((_almostEqual(pdot, s1dot) && _almostEqual(pdot, s2dot)) && (pdotnorm > s1dotnorm && pdotnorm > s2dotnorm)) {
        return Math.min(pdotnorm - s1dotnorm, pdotnorm - s2dotnorm);
      }
      if ((_almostEqual(pdot, s1dot) && _almostEqual(pdot, s2dot)) && (pdotnorm < s1dotnorm && pdotnorm < s2dotnorm)) {
        return -Math.min(s1dotnorm - pdotnorm, s2dotnorm - pdotnorm);
      }
    }

    return -(pdotnorm - s1dotnorm + (s1dotnorm - s2dotnorm) * (s1dot - pdot) / (s1dot - s2dot));
  },

  segmentDistance: function (A: Point, B: Point, E: Point, F: Point, direction: Point): number | null {
    const normal = {
      X: direction.Y,
      Y: -direction.X
    };

    const reverse = {
      X: -direction.X,
      Y: -direction.Y
    };

    const dotA = A.X * normal.X + A.Y * normal.Y;
    const dotB = B.X * normal.X + B.Y * normal.Y;
    const dotE = E.X * normal.X + E.Y * normal.Y;
    const dotF = F.X * normal.X + F.Y * normal.Y;

    const crossA = A.X * direction.X + A.Y * direction.Y;
    const crossB = B.X * direction.X + B.Y * direction.Y;
    const crossE = E.X * direction.X + E.Y * direction.Y;
    const crossF = F.X * direction.X + F.Y * direction.Y;

    const ABmin = Math.min(dotA, dotB);
    const ABmax = Math.max(dotA, dotB);

    const EFmax = Math.max(dotE, dotF);
    const EFmin = Math.min(dotE, dotF);

    if (_almostEqual(ABmax, EFmin, TOL) || _almostEqual(ABmin, EFmax, TOL)) {
      return null;
    }
    if (ABmax < EFmin || ABmin > EFmax) {
      return null;
    }

    let overlap: number;

    if ((ABmax > EFmax && ABmin < EFmin) || (EFmax > ABmax && EFmin < ABmin)) {
      overlap = 1;
    }
    else {
      const minMax = Math.min(ABmax, EFmax);
      const maxMin = Math.max(ABmin, EFmin);

      const maxMax = Math.max(ABmax, EFmax);
      const minMin = Math.min(ABmin, EFmin);

      overlap = (minMax - maxMin) / (maxMax - minMin);
    }

    const crossABE = (E.Y - A.Y) * (B.X - A.X) - (E.X - A.X) * (B.Y - A.Y);
    const crossABF = (F.Y - A.Y) * (B.X - A.X) - (F.X - A.X) * (B.Y - A.Y);

    if (_almostEqual(crossABE, 0) && _almostEqual(crossABF, 0)) {
      const ABnorm = { X: B.Y - A.Y, Y: A.X - B.X };
      const EFnorm = { X: F.Y - E.Y, Y: E.X - F.X };

      const ABnormlength = Math.sqrt(ABnorm.X * ABnorm.X + ABnorm.Y * ABnorm.Y);
      ABnorm.X /= ABnormlength;
      ABnorm.Y /= ABnormlength;

      const EFnormlength = Math.sqrt(EFnorm.X * EFnorm.X + EFnorm.Y * EFnorm.Y);
      EFnorm.X /= EFnormlength;
      EFnorm.Y /= EFnormlength;

      if (Math.abs(ABnorm.Y * EFnorm.X - ABnorm.X * EFnorm.Y) < TOL && ABnorm.Y * EFnorm.Y + ABnorm.X * EFnorm.X < 0) {
        const normdot = ABnorm.Y * direction.Y + ABnorm.X * direction.X;
        if (_almostEqual(normdot, 0, TOL)) {
          return null;
        }
        if (normdot < 0) {
          return 0;
        }
      }
      return null;
    }

    const distances: number[] = [];

    if (_almostEqual(dotA, dotE)) {
      distances.push(crossA - crossE);
    }
    else if (_almostEqual(dotA, dotF)) {
      distances.push(crossA - crossF);
    }
    else if (dotA > EFmin && dotA < EFmax) {
      let d = this.pointDistance(A, E, F, reverse);
      if (d !== null && _almostEqual(d, 0)) {
        const dB = this.pointDistance(B, E, F, reverse, true);
        if (dB !== null && (dB < 0 || _almostEqual(dB * overlap, 0))) {
          d = null;
        }
      }
      if (d !== null) {
        distances.push(d);
      }
    }

    if (_almostEqual(dotB, dotE)) {
      distances.push(crossB - crossE);
    }
    else if (_almostEqual(dotB, dotF)) {
      distances.push(crossB - crossF);
    }
    else if (dotB > EFmin && dotB < EFmax) {
      let d = this.pointDistance(B, E, F, reverse);

      if (d !== null && _almostEqual(d, 0)) {
        const dA = this.pointDistance(A, E, F, reverse, true);
        if (dA !== null && (dA < 0 || _almostEqual(dA * overlap, 0))) {
          d = null;
        }
      }
      if (d !== null) {
        distances.push(d);
      }
    }

    if (dotE > ABmin && dotE < ABmax) {
      let d = this.pointDistance(E, A, B, direction);
      if (d !== null && _almostEqual(d, 0)) {
        const dF = this.pointDistance(F, A, B, direction, true);
        if (dF !== null && (dF < 0 || _almostEqual(dF * overlap, 0))) {
          d = null;
        }
      }
      if (d !== null) {
        distances.push(d);
      }
    }

    if (dotF > ABmin && dotF < ABmax) {
      let d = this.pointDistance(F, A, B, direction);
      if (d !== null && _almostEqual(d, 0)) {
        const dE = this.pointDistance(E, A, B, direction, true);
        if (dE !== null && (dE < 0 || _almostEqual(dE * overlap, 0))) {
          d = null;
        }
      }
      if (d !== null) {
        distances.push(d);
      }
    }

    if (distances.length == 0) {
      return null;
    }

    return Math.min.apply(Math, distances);
  },

  polygonSlideDistance: function (A: Polygon, B: Polygon, direction: Point, ignoreNegative?: boolean): number | null {
    let A1, A2, B1, B2;
    const Aoffsetx = (A as any).offsetx || 0;
    const Aoffsety = (A as any).offsety || 0;

    const Boffsetx = (B as any).offsetx || 0;
    const Boffsety = (B as any).offsety || 0;

    const edgeA = A.slice(0) as Polygon;
    const edgeB = B.slice(0) as Polygon;

    if (edgeA[0] !== edgeA[edgeA.length - 1]) {
      edgeA.push(edgeA[0]);
    }

    if (edgeB[0] !== edgeB[edgeB.length - 1]) {
      edgeB.push(edgeB[0]);
    }

    let distance: number | null = null;
    let d: number | null;

    const dir = _normalizeVector(direction);

    for (let i = 0; i < edgeB.length - 1; i++) {
      for (let j = 0; j < edgeA.length - 1; j++) {
        A1 = { X: edgeA[j].X + Aoffsetx, Y: edgeA[j].Y + Aoffsety };
        A2 = { X: edgeA[j + 1].X + Aoffsetx, Y: edgeA[j + 1].Y + Aoffsety };
        B1 = { X: edgeB[i].X + Boffsetx, Y: edgeB[i].Y + Boffsety };
        B2 = { X: edgeB[i + 1].X + Boffsetx, Y: edgeB[i + 1].Y + Boffsety };

        if ((_almostEqual(A1.X, A2.X) && _almostEqual(A1.Y, A2.Y)) || (_almostEqual(B1.X, B2.X) && _almostEqual(B1.Y, B2.Y))) {
          continue;
        }

        d = this.segmentDistance(A1, A2, B1, B2, dir);

        if (d !== null && (distance === null || d < distance)) {
          if (!ignoreNegative || d > 0 || _almostEqual(d, 0)) {
            distance = d;
          }
        }
      }
    }
    return distance;
  },

  polygonProjectionDistance: function (A: Polygon, B: Polygon, direction: Point): number | null {
    const Boffsetx = (B as any).offsetx || 0;
    const Boffsety = (B as any).offsety || 0;

    const Aoffsetx = (A as any).offsetx || 0;
    const Aoffsety = (A as any).offsety || 0;

    const edgeA = A.slice(0) as Polygon;
    const edgeB = B.slice(0) as Polygon;

    if (edgeA[0] !== edgeA[edgeA.length - 1]) {
      edgeA.push(edgeA[0]);
    }

    if (edgeB[0] !== edgeB[edgeB.length - 1]) {
      edgeB.push(edgeB[0]);
    }

    let distance: number | null = null;
    let p, d, s1, s2;

    for (let i = 0; i < edgeB.length; i++) {
      let minprojection: number | null = null;
      for (let j = 0; j < edgeA.length - 1; j++) {
        p = { X: edgeB[i].X + Boffsetx, Y: edgeB[i].Y + Boffsety };
        s1 = { X: edgeA[j].X + Aoffsetx, Y: edgeA[j].Y + Aoffsety };
        s2 = { X: edgeA[j + 1].X + Aoffsetx, Y: edgeA[j + 1].Y + Aoffsety };

        if (Math.abs((s2.Y - s1.Y) * direction.X - (s2.X - s1.X) * direction.Y) < TOL) {
          continue;
        }

        d = this.pointDistance(p, s1, s2, direction);

        if (d !== null && (minprojection === null || d < minprojection)) {
          minprojection = d;
        }
      }
      if (minprojection !== null && (distance === null || minprojection > distance)) {
        distance = minprojection;
      }
    }

    return distance;
  },

  searchStartPoint: function (A: Polygon, B: Polygon, inside: boolean, NFP?: Polygon[]): Point | null {
    const edgeA = A.slice(0) as Polygon;
    const edgeB = B.slice(0) as Polygon;

    if (edgeA[0] !== edgeA[edgeA.length - 1]) {
      edgeA.push(edgeA[0]);
    }

    if (edgeB[0] !== edgeB[edgeB.length - 1]) {
      edgeB.push(edgeB[0]);
    }

    for (let i = 0; i < edgeA.length - 1; i++) {
      if (!(edgeA[i] as any).marked) {
        (edgeA[i] as any).marked = true;
        for (let j = 0; j < edgeB.length; j++) {
          (edgeB as any).offsetx = edgeA[i].X - edgeB[j].X;
          (edgeB as any).offsety = edgeA[i].Y - edgeB[j].Y;

          let Binside: boolean | null = null;
          for (let k = 0; k < edgeB.length; k++) {
            const inpoly = this.pointInPolygon({ X: edgeB[k].X + (edgeB as any).offsetx, Y: edgeB[k].Y + (edgeB as any).offsety }, edgeA);
            if (inpoly !== null) {
              Binside = inpoly;
              break;
            }
          }

          if (Binside === null) {
            return null;
          }

          let startPoint = { X: (edgeB as any).offsetx, Y: (edgeB as any).offsety };
          if (((Binside && inside) || (!Binside && !inside)) && !this.intersect(edgeA, edgeB) && !inNfp(startPoint, NFP)) {
            return startPoint;
          }

          let vx = edgeA[i + 1].X - edgeA[i].X;
          let vy = edgeA[i + 1].Y - edgeA[i].Y;

          const d1 = this.polygonProjectionDistance(edgeA, edgeB, { X: vx, Y: vy });
          const d2 = this.polygonProjectionDistance(edgeB, edgeA, { X: -vx, Y: -vy });

          let d: number | null = null;

          if (d1 === null && d2 === null) {
            // nothing
          }
          else if (d1 === null) {
            d = d2;
          }
          else if (d2 === null) {
            d = d1;
          }
          else {
            d = Math.min(d1, d2);
          }

          if (d !== null && !_almostEqual(d, 0) && d > 0) {
            // ok
          }
          else {
            continue;
          }

          const vd2 = vx * vx + vy * vy;

          if (d * d < vd2 && !_almostEqual(d * d, vd2)) {
            const vd = Math.sqrt(vx * vx + vy * vy);
            vx *= d / vd;
            vy *= d / vd;
          }

          (edgeB as any).offsetx += vx;
          (edgeB as any).offsety += vy;

          for (let k = 0; k < edgeB.length; k++) {
            const inpoly = this.pointInPolygon({ X: edgeB[k].X + (edgeB as any).offsetx, Y: edgeB[k].Y + (edgeB as any).offsety }, edgeA);
            if (inpoly !== null) {
              Binside = inpoly;
              break;
            }
          }
          startPoint = { X: (edgeB as any).offsetx, Y: (edgeB as any).offsety };
          if (((Binside && inside) || (!Binside && !inside)) && !this.intersect(edgeA, edgeB) && !inNfp(startPoint, NFP)) {
            return startPoint;
          }
        }
      }
    }

    function inNfp(p: Point, nfp?: Polygon[]): boolean {
      if (!nfp || nfp.length == 0) {
        return false;
      }

      for (let i = 0; i < nfp.length; i++) {
        for (let j = 0; j < nfp[i].length; j++) {
          if (_almostEqual(p.X, nfp[i][j].X) && _almostEqual(p.Y, nfp[i][j].Y)) {
            return true;
          }
        }
      }

      return false;
    }

    return null;
  },

  isRectangle: function (poly: Point[], _tolerance?: number): boolean {
    const bb = this.getPolygonBounds(poly);
    if (!bb) return false;
    const tol = _tolerance || TOL;

    for (let i = 0; i < poly.length; i++) {
      if (!_almostEqual(poly[i].X, bb.x, tol) && !_almostEqual(poly[i].X, bb.x + bb.width, tol)) {
        return false;
      }
      if (!_almostEqual(poly[i].Y, bb.y, tol) && !_almostEqual(poly[i].Y, bb.y + bb.height, tol)) {
        return false;
      }
    }

    return true;
  },

  noFitPolygonRectangle: function (A: Point[], B: Point[]): Point[][] | null {
    let minAx = A[0].X;
    let minAy = A[0].Y;
    let maxAx = A[0].X;
    let maxAy = A[0].Y;

    for (let i = 1; i < A.length; i++) {
      if (A[i].X < minAx) minAx = A[i].X;
      if (A[i].Y < minAy) minAy = A[i].Y;
      if (A[i].X > maxAx) maxAx = A[i].X;
      if (A[i].Y > maxAy) maxAy = A[i].Y;
    }

    let minBx = B[0].X;
    let minBy = B[0].Y;
    let maxBx = B[0].X;
    let maxBy = B[0].Y;
    for (let i = 1; i < B.length; i++) {
      if (B[i].X < minBx) minBx = B[i].X;
      if (B[i].Y < minBy) minBy = B[i].Y;
      if (B[i].X > maxBx) maxBx = B[i].X;
      if (B[i].Y > maxBy) maxBy = B[i].Y;
    }

    if (maxBx - minBx > maxAx - minAx) return null;
    if (maxBy - minBy > maxAy - minAy) return null;

    return [[
      { X: minAx - minBx + B[0].X, Y: minAy - minBy + B[0].Y },
      { X: maxAx - maxBx + B[0].X, Y: minAy - minBy + B[0].Y },
      { X: maxAx - maxBx + B[0].X, Y: maxAy - maxBy + B[0].Y },
      { X: minAx - minBx + B[0].X, Y: maxAy - maxBy + B[0].Y }
    ]];
  },

  noFitPolygon: function (A: Polygon, B: Polygon, inside: boolean, searchEdges?: boolean): Point[][] | null {
    if (!A || A.length < 3 || !B || B.length < 3) {
      return null;
    }

    (A as any).offsetx = 0;
    (A as any).offsety = 0;

    let minA = A[0].Y;
    let minAindex = 0;

    let maxB = B[0].Y;
    let maxBindex = 0;

    for (let i = 0; i < A.length; i++) {
      (A[i] as any).marked = false;
      if (A[i].Y < minA) {
        minA = A[i].Y;
        minAindex = i;
      }
    }

    for (let i = 0; i < B.length; i++) {
      (B[i] as any).marked = false;
      if (B[i].Y > maxB) {
        maxB = B[i].Y;
        maxBindex = i;
      }
    }

    let startpoint: Point | null;
    if (!inside) {
      startpoint = {
        X: A[minAindex].X - B[maxBindex].X,
        Y: A[minAindex].Y - B[maxBindex].Y
      };
    }
    else {
      startpoint = this.searchStartPoint(A, B, true);
    }

    const NFPlist: Point[][] = [];

    while (startpoint !== null) {
      (B as any).offsetx = startpoint.X;
      (B as any).offsety = startpoint.Y;

      let touching: any[] = [];
      let prevvector: any = null; // Declare prevvector here

      let NFP: Point[] | null = [{ // Allow NFP to be null
        X: B[0].X + (B as any).offsetx,
        Y: B[0].Y + (B as any).offsety
      }];

      let referencex = B[0].X + (B as any).offsetx;
      let referencey = B[0].Y + (B as any).offsety;
      const startx = referencex;
      const starty = referencey;
      let counter = 0;

      while (counter < 10 * (A.length + B.length)) {
        touching = [];
        for (let i = 0; i < A.length; i++) {
          const nexti = (i == A.length - 1) ? 0 : i + 1;
          for (let j = 0; j < B.length; j++) {
            const nextj = (j == B.length - 1) ? 0 : j + 1;
            if (_almostEqual(A[i].X, B[j].X + (B as any).offsetx) && _almostEqual(A[i].Y, B[j].Y + (B as any).offsety)) {
              touching.push({ type: 0, A: i, B: j });
            }
            else if (_onSegment(A[i], A[nexti], { X: B[j].X + (B as any).offsetx, Y: B[j].Y + (B as any).offsety })) {
              touching.push({ type: 1, A: nexti, B: j });
            }
            else if (_onSegment({ X: B[j].X + (B as any).offsetx, Y: B[j].Y + (B as any).offsety }, { X: B[nextj].X + (B as any).offsetx, Y: B[nextj].Y + (B as any).offsety }, A[i])) {
              touching.push({ type: 2, A: i, B: nextj });
            }
          }
        }

        const vectors: any[] = [];
        for (let i = 0; i < touching.length; i++) {
          const vertexA = A[touching[i].A];
          (vertexA as any).marked = true;

          let prevAindex = touching[i].A - 1;
          let nextAindex = touching[i].A + 1;

          prevAindex = (prevAindex < 0) ? A.length - 1 : prevAindex;
          nextAindex = (nextAindex >= A.length) ? 0 : nextAindex;

          const prevA = A[prevAindex];
          const nextA = A[nextAindex];

          const vertexB = B[touching[i].B];

          let prevBindex = touching[i].B - 1;
          let nextBindex = touching[i].B + 1;

          prevBindex = (prevBindex < 0) ? B.length - 1 : prevBindex;
          nextBindex = (nextBindex >= B.length) ? 0 : nextBindex;

          const prevB = B[prevBindex];
          const nextB = B[nextBindex];

          if (touching[i].type == 0) {
            const vA1 = {
              X: prevA.X - vertexA.X,
              Y: prevA.Y - vertexA.Y,
              start: vertexA,
              end: prevA
            };

            const vA2 = {
              X: nextA.X - vertexA.X,
              Y: nextA.Y - vertexA.Y,
              start: vertexA,
              end: nextA
            };

            const vB1 = {
              X: vertexB.X - prevB.X,
              Y: vertexB.Y - prevB.Y,
              start: prevB,
              end: vertexB
            };

            const vB2 = {
              X: vertexB.X - nextB.X,
              Y: vertexB.Y - nextB.Y,
              start: nextB,
              end: vertexB
            };

            vectors.push(vA1);
            vectors.push(vA2);
            vectors.push(vB1);
            vectors.push(vB2);
          }
          else if (touching[i].type == 1) {
            vectors.push({
              X: vertexA.X - (vertexB.X + (B as any).offsetx),
              Y: vertexA.Y - (vertexB.Y + (B as any).offsety),
              start: prevA,
              end: vertexA
            });

            vectors.push({
              X: prevA.X - (vertexB.X + (B as any).offsetx),
              Y: prevA.Y - (vertexB.Y + (B as any).offsety),
              start: vertexA,
              end: prevA
            });
          }
          else if (touching[i].type == 2) {
            vectors.push({
              X: vertexA.X - (vertexB.X + (B as any).offsetx),
              Y: vertexA.Y - (vertexB.Y + (B as any).offsety),
              start: prevB,
              end: vertexB
            });

            vectors.push({
              X: vertexA.X - (prevB.X + (B as any).offsetx),
              Y: vertexA.Y - (prevB.Y + (B as any).offsety),
              start: vertexB,
              end: prevB
            });
          }
        }

        let translate: any = null;
        let maxd = 0;

        for (let i = 0; i < vectors.length; i++) {
          if (vectors[i].X == 0 && vectors[i].Y == 0) {
            continue;
          }

          if (prevvector && vectors[i].Y * prevvector.Y + vectors[i].X * prevvector.X < 0) {
            const vectorlength = Math.sqrt(vectors[i].X * vectors[i].X + vectors[i].Y * vectors[i].Y);
            const unitv = { X: vectors[i].X / vectorlength, Y: vectors[i].Y / vectorlength };

            const prevlength = Math.sqrt(prevvector.X * prevvector.X + prevvector.Y * prevvector.Y);
            const prevunit = { X: prevvector.X / prevlength, Y: prevvector.Y / prevlength };

            if (Math.abs(unitv.Y * prevunit.X - unitv.X * prevunit.Y) < 0.0001) {
              continue;
            }
          }

          let d = this.polygonSlideDistance(A, B, vectors[i], true);
          const vecd2 = vectors[i].X * vectors[i].X + vectors[i].Y * vectors[i].Y;

          if (d === null || d * d > vecd2) {
            const vecd = Math.sqrt(vectors[i].X * vectors[i].X + vectors[i].Y * vectors[i].Y);
            d = vecd;
          }

          if (d !== null && d > maxd) {
            maxd = d;
            translate = vectors[i];
          }
        }

        if (translate === null || _almostEqual(maxd, 0)) {
          NFP = null;
          break;
        }

        translate.start.marked = true;
        translate.end.marked = true;

        prevvector = translate;

        const vlength2 = translate.X * translate.X + translate.Y * translate.Y;
        if (maxd * maxd < vlength2 && !_almostEqual(maxd * maxd, vlength2)) {
          const scale = Math.sqrt((maxd * maxd) / vlength2);
          translate.X *= scale;
          translate.Y *= scale;
        }

        referencex += translate.X;
        referencey += translate.Y;

        if (_almostEqual(referencex, startx) && _almostEqual(referencey, starty)) {
          break;
        }

        let looped = false;
        if (NFP && NFP.length > 0) {
          for (let i = 0; i < NFP.length - 1; i++) {
            if (_almostEqual(referencex, NFP[i].X) && _almostEqual(referencey, NFP[i].Y)) {
              looped = true;
            }
          }
        }

        if (looped) {
          break;
        }

        if (NFP) {
          NFP.push({
            X: referencex,
            Y: referencey
          });
        }

        (B as any).offsetx += translate.X;
        (B as any).offsety += translate.Y;

        counter++;
      }

      if (NFP && NFP.length > 0) {
        NFPlist.push(NFP);
      }

      if (!searchEdges) {
        break;
      }

      startpoint = this.searchStartPoint(A, B, inside, NFPlist);
    }

    return NFPlist;
  },

  polygonHull: function (A: Polygon, B: Polygon): Point[] | null {
    if (!A || A.length < 3 || !B || B.length < 3) {
      return null;
    }

    let Aoffsetx = (A as any).offsetx || 0;
    let Aoffsety = (A as any).offsety || 0;
    let Boffsetx = (B as any).offsetx || 0;
    let Boffsety = (B as any).offsety || 0;

    let miny = A[0].Y + Aoffsety; // Changed to include offset
    let startPolygon = A;
    let startIndex = 0;

    for (let i = 0; i < A.length; i++) {
      if (A[i].Y + Aoffsety < miny) {
        miny = A[i].Y + Aoffsety;
        startPolygon = A;
        startIndex = i;
      }
    }

    for (let i = 0; i < B.length; i++) {
      if (B[i].Y + Boffsety < miny) {
        miny = B[i].Y + Boffsety;
        startPolygon = B;
        startIndex = i;
      }
    }

    if (startPolygon == B) {
      const temp = B;
      B = A;
      A = temp;
      Aoffsetx = (A as any).offsetx || 0;
      Aoffsety = (A as any).offsety || 0;
      Boffsetx = (B as any).offsetx || 0;
      Boffsety = (B as any).offsety || 0;
    }

    const edgeA = A.slice(0);
    const edgeB = B.slice(0);

    const C: Point[] = [];
    let current = startIndex;
    let intercept1: number | null = null;
    let intercept2: number | null = null;

    for (let i = 0; i < edgeA.length + 1; i++) {
      current = (current == edgeA.length) ? 0 : current;
      const next = (current == edgeA.length - 1) ? 0 : current + 1;
      let touching = false;
      for (let j = 0; j < edgeB.length; j++) {
        const nextj = (j == edgeB.length - 1) ? 0 : j + 1;
        if (_almostEqual(edgeA[current].X + Aoffsetx, edgeB[j].X + Boffsetx) && _almostEqual(edgeA[current].Y + Aoffsety, edgeB[j].Y + Boffsety)) {
          C.push({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety });
          intercept1 = j;
          touching = true;
          break;
        }
        else if (_onSegment({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety }, { X: edgeA[next].X + Aoffsetx, Y: edgeA[next].Y + Aoffsety }, { X: edgeB[j].X + Boffsetx, Y: edgeB[j].Y + Boffsety })) {
          C.push({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety });
          C.push({ X: edgeB[j].X + Boffsetx, Y: edgeB[j].Y + Boffsety });
          intercept1 = j;
          touching = true;
          break;
        }
        else if (_onSegment({ X: edgeB[j].X + Boffsetx, Y: edgeB[j].Y + Boffsety }, { X: edgeB[nextj].X + Boffsetx, Y: edgeB[nextj].Y + Boffsety }, { X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety })) {
          C.push({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety });
          C.push({ X: edgeB[nextj].X + Boffsetx, Y: edgeB[nextj].Y + Boffsety });
          intercept1 = nextj;
          touching = true;
          break;
        }
      }

      if (touching) {
        break;
      }

      C.push({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety });

      current++;
    }

    current = startIndex - 1;
    for (let i = 0; i < edgeA.length + 1; i++) {
      current = (current < 0) ? edgeA.length - 1 : current;
      const next = (current == 0) ? edgeA.length - 1 : current - 1;
      let touching = false;
      for (let j = 0; j < edgeB.length; j++) {
        const nextj = (j == edgeB.length - 1) ? 0 : j + 1;
        if (_almostEqual(edgeA[current].X + Aoffsetx, edgeB[j].X + Boffsetx) && _almostEqual(edgeA[current].Y + Aoffsety, edgeB[j].Y + Boffsety)) {
          C.unshift({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety });
          intercept2 = j;
          touching = true;
          break;
        }
        else if (_onSegment({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety }, { X: edgeA[next].X + Aoffsetx, Y: edgeA[next].Y + Aoffsety }, { X: edgeB[j].X + Boffsetx, Y: edgeB[j].Y + Boffsety })) {
          C.unshift({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety });
          C.unshift({ X: edgeB[j].X + Boffsetx, Y: edgeB[j].Y + Boffsety });
          intercept2 = j;
          touching = true;
          break;
        }
        else if (_onSegment({ X: edgeB[j].X + Boffsetx, Y: edgeB[j].Y + Boffsety }, { X: edgeB[nextj].X + Boffsetx, Y: edgeB[nextj].Y + Boffsety }, { X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety })) {
          C.unshift({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety });
          intercept2 = j;
          touching = true;
          break;
        }
      }

      if (touching) {
        break;
      }

      C.unshift({ X: edgeA[current].X + Aoffsetx, Y: edgeA[current].Y + Aoffsety });

      current--;
    }

    if (intercept1 === null || intercept2 === null) {
      return null;
    }

    current = intercept1 + 1;
    for (let i = 0; i < edgeB.length; i++) {
      current = (current == edgeB.length) ? 0 : current;
      C.push({ X: edgeB[current].X + Boffsetx, Y: edgeB[current].Y + Boffsety });

      if (current == intercept2) {
        break;
      }

      current++;
    }

    for (let i = 0; i < C.length; i++) {
      const next = (i == C.length - 1) ? 0 : i + 1;
      if (_almostEqual(C[i].X, C[next].X) && _almostEqual(C[i].Y, C[next].Y)) {
        C.splice(i, 1);
        i--;
      }
    }

    return C;
  },

  rotatePolygon: function (polygon: Polygon, angle: number): Polygon {
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
    const bounds = this.getPolygonBounds(rotated);
    if (bounds) {
      rotated.x = bounds.x;
      rotated.y = bounds.y;
      rotated.width = bounds.width;
      rotated.height = bounds.height;
    }

    return rotated;
  }
};

export default GeometryUtil;
