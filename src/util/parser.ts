import GeometryUtil from './geometry.js';
import Matrix, { MatrixArray } from './matrix.js';
import svgpath from 'svgpath';
import { Point } from '../types.js';

interface ParserConfig {
  tolerance: number;
  toleranceSvg: number;
}

class SvgParser {
  private svg: XMLDocument | null = null;
  private svgRoot: SVGSVGElement | null = null;
  private allowedElements = ['svg', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'rect', 'line'];
  private conf: ParserConfig = {
    tolerance: 2,
    toleranceSvg: 0.005
  };

  constructor() {
    this.svg = null;
    this.svgRoot = null;
  }

  config(config: { tolerance: number }): void {
    this.conf.tolerance = config.tolerance;
  }

  load(svgString: string): SVGSVGElement {
    if (!svgString || typeof svgString !== 'string') {
      throw Error('invalid SVG string');
    }

    const parser = new DOMParser();
    const svg = parser.parseFromString(svgString, "image/svg+xml");

    this.svgRoot = null;

    if (svg) {
      this.svg = svg;

      for (let i = 0; i < svg.childNodes.length; i++) {
        const child = svg.childNodes[i] as Element;
        if (child.tagName && child.tagName === 'svg') {
          this.svgRoot = child as unknown as SVGSVGElement;
          break;
        }
      }
    } else {
      throw new Error("Failed to parse SVG string");
    }

    if (!this.svgRoot) {
      if (svg.documentElement && svg.documentElement.tagName === 'svg') {
        this.svgRoot = svg.documentElement as unknown as SVGSVGElement;
      } else {
        throw new Error("SVG has no children or invalid format");
      }
    }
    return this.svgRoot;
  }

  cleanInput(): SVGSVGElement {
    if (!this.svgRoot) {
      throw new Error("No SVG root. Call load() first.");
    }
    // apply any transformations, so that all path positions etc will be in the same coordinate space
    this.applyTransform(this.svgRoot);

    // remove any g elements and bring all elements to the top level
    this.flatten(this.svgRoot);

    // remove any non-contour elements like text
    this.filter(this.allowedElements);

    // split any compound paths into individual path elements
    this.recurse(this.svgRoot, this.splitPath.bind(this));

    return this.svgRoot;
  }

  getStyle(): Element | false {
    if (!this.svgRoot) {
      return false;
    }
    
    for (let i = 0; i < this.svgRoot.childNodes.length; i++) {
      const el = this.svgRoot.childNodes[i] as Element;
      if (el.tagName === 'style') {
        return el;
      }
    }

    return false;
  }

  // takes an SVG transform string and returns corresponding Matrix
  transformParse(transformString: string): Matrix {
      const operations: Record<string, boolean> = {
        matrix: true,
        scale: true,
        rotate: true,
        translate: true,
        skewX: true,
        skewY: true
      };

      const CMD_SPLIT_RE = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*(.+?)\s*\)[\s,]*/;
      const PARAMS_SPLIT_RE = /[\s,]+/;

      const matrix = new Matrix();
      let cmd: string | undefined; 
      let params: number[];

      transformString.split(CMD_SPLIT_RE).forEach((item) => {
        if (!item.length) { return; }

        if (operations[item]) {
          cmd = item;
          return;
        }

        params = item.split(PARAMS_SPLIT_RE).map((i) => +i || 0);

        if (!cmd) return;

        switch (cmd) {
          case 'matrix':
            if (params.length === 6) {
              matrix.matrix(params as MatrixArray);
            }
            return;

          case 'scale':
            if (params.length === 1) {
              matrix.scale(params[0], params[0]);
            } else if (params.length === 2) {
              matrix.scale(params[0], params[1]);
            }
            return;

          case 'rotate':
            if (params.length === 1) {
              matrix.rotate(params[0], 0, 0);
            } else if (params.length === 3) {
              matrix.rotate(params[0], params[1], params[2]);
            }
            return;

          case 'translate':
            if (params.length === 1) {
              matrix.translate(params[0], 0);
            } else if (params.length === 2) {
              matrix.translate(params[0], params[1]);
            }
            return;

          case 'skewX':
            if (params.length === 1) {
              matrix.skewX(params[0]);
            }
            return;

          case 'skewY':
            if (params.length === 1) {
              matrix.skewY(params[0]);
            }
            return;
        }
      });

      return matrix;
  }

  applyTransform(element: Element, globalTransform?: string): void {
    globalTransform = globalTransform || '';

    let transformString = element.getAttribute('transform') || '';
    transformString = globalTransform + transformString;

    let transform: Matrix | undefined;

    if (transformString && transformString.length > 0) {
      transform = this.transformParse(transformString);
    }

    if (!transform) {
      transform = new Matrix();
    }

    const tarray = transform.toArray();
    const scale = Math.sqrt(tarray[0] * tarray[0] + tarray[2] * tarray[2]);

    if (element.tagName === 'g' || element.tagName === 'svg' || element.tagName === 'defs' || element.tagName === 'clipPath') {
      element.removeAttribute('transform');
      const children = Array.prototype.slice.call(element.childNodes) as Node[];

      for (let i = 0; i < children.length; i++) {
        const child = children[i] as Element;
        if (child.tagName) {
          this.applyTransform(child, transformString);
        }
      }
    }
    else if (transform && !transform.isIdentity()) {
      const id = element.getAttribute('id');
      const className = element.getAttribute('class');

      switch (element.tagName) {
        case 'ellipse': {
          if (!this.svg) break;
          const path = this.svg.createElementNS(element.namespaceURI, 'path');
          const cx = parseFloat(element.getAttribute('cx') || '0');
          const cy = parseFloat(element.getAttribute('cy') || '0');
          const rx = parseFloat(element.getAttribute('rx') || '0');
          const ry = parseFloat(element.getAttribute('ry') || '0');
          
          const dEllipse = `M ${cx-rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx+rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx-rx} ${cy} Z`;
          path.setAttribute('d', dEllipse);
          
          const transformPropertyEllipse = element.getAttribute('transform');
          if (transformPropertyEllipse) {
            path.setAttribute('transform', transformPropertyEllipse);
          }

          if (element.parentElement) {
            element.parentElement.replaceChild(path, element);
          }
          element = path;
          // Fallthrough to path handling
        }

        case 'path': {
          const dPath = element.getAttribute('d') || '';
          const p = svgpath(dPath).transform(tarray.join(' ')).abs().round(6).toString();
          element.setAttribute('d', p);
          element.removeAttribute('transform');
          break;
        }

        case 'circle': {
          const transformed = transform.calc(parseFloat(element.getAttribute('cx') || '0'), parseFloat(element.getAttribute('cy') || '0'));
          element.setAttribute('cx', transformed[0].toString());
          element.setAttribute('cy', transformed[1].toString());

          element.setAttribute('r', (parseFloat(element.getAttribute('r') || '0') * scale).toString());
          element.removeAttribute('transform');
          break;
        }

        case 'line': {
          const transformedStartPt = transform.calc(parseFloat(element.getAttribute('x1') || '0'), parseFloat(element.getAttribute('y1') || '0'));
          const transformedEndPt = transform.calc(parseFloat(element.getAttribute('x2') || '0'), parseFloat(element.getAttribute('y2') || '0'));
          element.setAttribute('x1', transformedStartPt[0].toString());
          element.setAttribute('y1', transformedStartPt[1].toString());
          element.setAttribute('x2', transformedEndPt[0].toString());
          element.setAttribute('y2', transformedEndPt[1].toString());
          element.removeAttribute('transform');
          break;
        }

        case 'rect': {
          if (!this.svg) break;
          const polygon = this.svg.createElementNS(element.namespaceURI, 'polygon');

          const x = parseFloat(element.getAttribute('x') || '0') || 0;
          const y = parseFloat(element.getAttribute('y') || '0') || 0;
          const w = parseFloat(element.getAttribute('width') || '0');
          const h = parseFloat(element.getAttribute('height') || '0');

          const p1 = { x: x, y: y };
          const p2 = { x: x + w, y: y };
          const p3 = { x: x + w, y: y + h };
          const p4 = { x: x, y: y + h };

          const pointsString = `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}`;
          polygon.setAttribute('points', pointsString);

          const transformPropertyRect = element.getAttribute('transform');
          if (transformPropertyRect) {
            polygon.setAttribute('transform', transformPropertyRect);
          }

          if (element.parentElement) {
            element.parentElement.replaceChild(polygon, element);
          }
          element = polygon;
          // Fallthrough to polygon handling
        }
        case 'polygon':
        case 'polyline': {
           const pointsVal = element.getAttribute('points') || '';
           const pointsList = pointsVal.trim().split(/[\s,]+/);
           const transformedPoints: string[] = [];
           
           for(let i=0; i<pointsList.length; i+=2) {
               const px = parseFloat(pointsList[i]);
               const py = parseFloat(pointsList[i+1]);
               if(isNaN(px) || isNaN(py)) continue;
               const pt = transform.calc(px, py);
               transformedPoints.push(pt[0] + ',' + pt[1]);
           }
           
           element.setAttribute('points', transformedPoints.join(' '));
           element.removeAttribute('transform');
           break;
        }
      }
      
      if (id) {
        element.setAttribute('id', id);
      }
      if (className) {
        element.setAttribute('class', className);
      }
    }
  }

  flatten(element: Element): void {
    for (let i = 0; i < element.childNodes.length; i++) {
      this.flatten(element.childNodes[i] as Element);
    }

    if (element.tagName !== 'svg') {
      if (element.parentElement) {
        while (element.childNodes.length > 0) {
          element.parentElement.appendChild(element.childNodes[0]);
        }
      }
    }
  }

  filter(whitelist: string[], element?: Element): void {
    if (!whitelist || whitelist.length === 0) {
      throw Error('invalid whitelist');
    }

    element = element || this.svgRoot!;

    for (let i = 0; i < element.childNodes.length; i++) {
      this.filter(whitelist, element.childNodes[i] as Element);
    }

    if (element.childNodes.length === 0 && whitelist.indexOf(element.tagName) < 0) {
      if (element.parentElement) {
          element.parentElement.removeChild(element);
      }
    }
  }

  splitPath(path: Element): Element[] | false {
    if (!path || path.tagName !== 'path' || !path.parentElement) {
      return false;
    }

    const d = path.getAttribute('d');
    if (!d) return false;
    
    const pathObj = svgpath(d).abs().unshort();
    const segs: { cmd: string; params: number[] }[] = [];
    pathObj.iterate((s) => {
        segs.push({ cmd: s[0], params: s.slice(1) as number[] });
    });
    
    const subPaths: any[][] = [];
    let currentSubPath: any[] = [];
    
    segs.forEach(s => {
        if (s.cmd === 'M') {
            if (currentSubPath.length > 0) {
                subPaths.push(currentSubPath);
                currentSubPath = [];
            }
        }
        currentSubPath.push(s);
    });
    if (currentSubPath.length > 0) {
        subPaths.push(currentSubPath);
    }
    
    if (subPaths.length <= 1) {
        return false;
    }
    
    const addedPaths: Element[] = [];
    subPaths.forEach(sub => {
        let newD = "";
        sub.forEach(s => {
           newD += s.cmd + " " + s.params.join(" ") + " "; 
        });
        
        const p = path.cloneNode() as Element;
        p.setAttribute('d', newD);
        path.parentElement!.insertBefore(p, path);
        addedPaths.push(p);
    });
    
    path.remove();
    return addedPaths;
  }

  recurse(element: Element, func: (el: Element) => void): void {
    const children = Array.prototype.slice.call(element.childNodes) as Node[];
    for (let i = 0; i < children.length; i++) {
        const child = children[i] as Element;
        if(child.tagName) {
            this.recurse(child, func);
        }
    }
    func(element);
  }

  polygonify(element: Element): Point[] {
    const poly: Point[] = [];

    switch (element.tagName) {
      case 'polygon':
      case 'polyline': {
        const pointsVal = element.getAttribute('points') || '';
        const pointsList = pointsVal.trim().split(/[\s,]+/);
        for(let i=0; i<pointsList.length; i+=2) {
             const px = parseFloat(pointsList[i]);
             const py = parseFloat(pointsList[i+1]);
             if(!isNaN(px) && !isNaN(py)) {
               poly.push({ X: px, Y: py });
             }
        }
        break;
      }
        
      case 'rect': {
        const x = parseFloat(element.getAttribute('x') || '0') || 0;
        const y = parseFloat(element.getAttribute('y') || '0') || 0;
        const w = parseFloat(element.getAttribute('width') || '0');
        const h = parseFloat(element.getAttribute('height') || '0');
        
        poly.push({ X: x, Y: y });
        poly.push({ X: x + w, Y: y });
        poly.push({ X: x + w, Y: y + h });
        poly.push({ X: x, Y: y + h });
        break;
      }
        
      case 'circle': {
        const radius = parseFloat(element.getAttribute('r') || '0');
        const cx = parseFloat(element.getAttribute('cx') || '0');
        const cy = parseFloat(element.getAttribute('cy') || '0');

        let num = Math.ceil((2 * Math.PI) / Math.acos(1 - (this.conf.tolerance / radius)));

        if (num < 3 || isNaN(num)) {
          num = 3;
        }

        for (let i = 0; i < num; i++) {
          const theta = i * ((2 * Math.PI) / num);
          poly.push({
            X: radius * Math.cos(theta) + cx,
            Y: radius * Math.sin(theta) + cy
          });
        }
        break;
      }
        
      case 'ellipse': {
        const rx = parseFloat(element.getAttribute('rx') || '0');
        const ry = parseFloat(element.getAttribute('ry') || '0');
        const maxradius = Math.max(rx, ry);

        const cxEllipse = parseFloat(element.getAttribute('cx') || '0');
        const cyEllipse = parseFloat(element.getAttribute('cy') || '0');

        let numEllipse = Math.ceil((2 * Math.PI) / Math.acos(1 - (this.conf.tolerance / maxradius)));

        if (numEllipse < 3 || isNaN(numEllipse)) {
          numEllipse = 3;
        }

        for (let i = 0; i < numEllipse; i++) {
          const theta = i * ((2 * Math.PI) / numEllipse);
          poly.push({
            X: rx * Math.cos(theta) + cxEllipse,
            Y: ry * Math.sin(theta) + cyEllipse
          });
        }
        break;
      }
        
      case 'path': {
        const d = element.getAttribute('d') || '';
        const pathObj = svgpath(d).abs().unshort();
        
        let x=0, y=0;
        
        pathObj.iterate((s, _index, curX, curY) => {
            const command = s[0];
            const params = s.slice(1) as number[];
            
            x = curX;
            y = curY;
            
            switch(command){
                case 'M':
                case 'L':
                poly.push({ X: params[0], Y: params[1] });
                    break;
                case 'H':
                poly.push({ X: params[0], Y: y });
                    break;
                case 'V':
                poly.push({ X: x, Y: params[0] });
                    break;
                    
                case 'C': {
                const p1 = { X: x, Y: y };
                const c1 = { X: params[0], Y: params[1] };
                const c2 = { X: params[2], Y: params[3] };
                const p2 = { X: params[4], Y: params[5] };
                    
                    const pts = GeometryUtil.CubicBezier.linearize(p1, p2, c1, c2, this.conf.tolerance);
                    pts.shift();
                    pts.forEach(p => poly.push(p));
                    break;
                }
                    
                case 'Q': {
                const p1Q = { X: x, Y: y };
                const c1Q = { X: params[0], Y: params[1] };
                const p2Q = { X: params[2], Y: params[3] };
                    
                    const ptsQ = GeometryUtil.QuadraticBezier.linearize(p1Q, p2Q, c1Q, this.conf.tolerance);
                    ptsQ.shift();
                    ptsQ.forEach(p => poly.push(p));
                    break;
                }
                    
                case 'A': {
                const p1A = { X: x, Y: y };
                const p2A = { X: params[5], Y: params[6] };
                    const rx = params[0];
                    const ry = params[1];
                    const angle = params[2];
                    const largeArc = params[3];
                    const sweep = params[4];
                    
                    const ptsA = GeometryUtil.Arc.linearize(p1A, p2A, rx, ry, angle, largeArc, sweep, this.conf.tolerance);
                    ptsA.shift();
                    ptsA.forEach(p => poly.push(p));
                    break;
                }
            }
        });
        
        break;
      }
    }

    while (poly.length > 0 && GeometryUtil.almostEqual(poly[0].X, poly[poly.length - 1].X, this.conf.toleranceSvg) && GeometryUtil.almostEqual(poly[0].Y, poly[poly.length - 1].Y, this.conf.toleranceSvg)) {
      poly.pop();
    }

    return poly;
  }
}

export default new SvgParser();
