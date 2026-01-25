import GeometryUtil from './geometry.js';
import Matrix from './matrix.js';
import svgpath from 'svgpath';

class SvgParser {
  constructor() {
    this.svg = null;
    this.svgRoot = null;
    this.allowedElements = ['svg', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'rect', 'line'];
    this.conf = {
      tolerance: 2, // max bound for bezier->line segment conversion, in native SVG units
      toleranceSvg: 0.005 // fudge factor for browser inaccuracy in SVG unit handling
    };
  }

  config(config) {
    this.conf.tolerance = config.tolerance;
  }

  load(svgString) {
    if (!svgString || typeof svgString !== 'string') {
      throw Error('invalid SVG string');
    }

    const parser = new DOMParser();
    const svg = parser.parseFromString(svgString, "image/svg+xml");

    this.svgRoot = null;

    if (svg) {
      this.svg = svg;

      for (let i = 0; i < svg.childNodes.length; i++) {
        const child = svg.childNodes[i];
        if (child.tagName && child.tagName == 'svg') {
          this.svgRoot = child;
          break;
        }
      }
    } else {
      throw new Error("Failed to parse SVG string");
    }

    if (!this.svgRoot) {
      // Try to handle case where the parser returned an error document or just the root if it was a fragment
      if (svg.documentElement && svg.documentElement.tagName == 'svg') {
          this.svgRoot = svg.documentElement;
      } else {
          throw new Error("SVG has no children or invalid format");
      }
    }
    return this.svgRoot;
  }

  cleanInput() {
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

  getStyle() {
    if (!this.svgRoot) {
      return false;
    }
    // Search recursively for style tags? The original just looked at direct children mostly? 
    // The original code: for(var i=0; i<this.svgRoot.childNodes.length; i++)...
    
    for (let i = 0; i < this.svgRoot.childNodes.length; i++) {
      const el = this.svgRoot.childNodes[i];
      if (el.tagName == 'style') {
        return el;
      }
    }

    return false;
  }

  // takes an SVG transform string and returns corresponding SVGMatrix
  transformParse(transformString) {
      const operations = {
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
      let cmd; 
      let params;

      // Split value into ['', 'translate', '10 50', '', 'scale', '2', '', 'rotate',  '-45', '']
      transformString.split(CMD_SPLIT_RE).forEach(function (item) {

        // Skip empty elements
        if (!item.length) { return; }

        // remember operation
        if (typeof operations[item] !== 'undefined') {
          cmd = item;
          return;
        }

        // extract params & add operation to matrix
        params = item.split(PARAMS_SPLIT_RE).map(function (i) {
          return +i || 0;
        });

        // If params count is not correct - ignore command
        switch (cmd) {
          case 'matrix':
            if (params.length === 6) {
              matrix.matrix(params);
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

  applyTransform(element, globalTransform) {
    globalTransform = globalTransform || '';

    let transformString = element.getAttribute('transform') || '';
    transformString = globalTransform + transformString;

    let transform;

    if (transformString && transformString.length > 0) {
      transform = this.transformParse(transformString);
    }

    if (!transform) {
      transform = new Matrix();
    }

    const tarray = transform.toArray();

    // decompose affine matrix to rotate, scale components (translate is just the 3rd column)
    // var rotate = Math.atan2(tarray[1], tarray[3]) * 180 / Math.PI;
    const scale = Math.sqrt(tarray[0] * tarray[0] + tarray[2] * tarray[2]);

    if (element.tagName == 'g' || element.tagName == 'svg' || element.tagName == 'defs' || element.tagName == 'clipPath') {
      element.removeAttribute('transform');
      const children = Array.prototype.slice.call(element.childNodes);

      for (let i = 0; i < children.length; i++) {
        if (children[i].tagName) { // skip text nodes
          this.applyTransform(children[i], transformString);
        }
      }
    }
    else if (transform && !transform.isIdentity()) {
      const id = element.getAttribute('id')
      const className = element.getAttribute('class')

      switch (element.tagName) {
        case 'ellipse': {
          // the goal is to remove the transform property, but an ellipse without a transform will have no rotation
          // for the sake of simplicity, we will replace the ellipse with a path, and apply the transform to that path
          let path = this.svg.createElementNS(element.namespaceURI, 'path');
          const cx = parseFloat(element.getAttribute('cx'));
          const cy = parseFloat(element.getAttribute('cy'));
          const rx = parseFloat(element.getAttribute('rx'));
          const ry = parseFloat(element.getAttribute('ry'));
          
          // M cx-rx, cy 
          // A rx, ry 0 1 0 cx+rx cy
          // A rx, ry 0 1 0 cx-rx cy
          // Z
          // Hand-crafting path data for ellipse
          const dEllipse = `M ${cx-rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx+rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx-rx} ${cy} Z`;
          path.setAttribute('d', dEllipse);
          
          const transformPropertyEllipse = element.getAttribute('transform');
          if (transformPropertyEllipse) {
            path.setAttribute('transform', transformPropertyEllipse);
          }

          element.parentElement.replaceChild(path, element);
          element = path;
          // Fallthrough to path handling
        }

        case 'path': {
          const dPath = element.getAttribute('d');
          // Use svgpath to apply transform
          const p = svgpath(dPath).transform(tarray.join(' ')).abs().round(6).toString();
          element.setAttribute('d', p);
          element.removeAttribute('transform');
          break;
        }

        case 'circle': {
          const transformed = transform.calc(parseFloat(element.getAttribute('cx')), parseFloat(element.getAttribute('cy')));
          element.setAttribute('cx', transformed[0]);
          element.setAttribute('cy', transformed[1]);

          // skew not supported
          element.setAttribute('r', parseFloat(element.getAttribute('r')) * scale);
          element.removeAttribute('transform');
          break;
        }

        case 'line': {
          const transformedStartPt = transform.calc(parseFloat(element.getAttribute('x1')), parseFloat(element.getAttribute('y1')));
          const transformedEndPt = transform.calc(parseFloat(element.getAttribute('x2')), parseFloat(element.getAttribute('y2')));
          element.setAttribute('x1', transformedStartPt[0].toString());
          element.setAttribute('y1', transformedStartPt[1].toString());
          element.setAttribute('x2', transformedEndPt[0].toString());
          element.setAttribute('y2', transformedEndPt[1].toString());
          element.removeAttribute('transform');
          break;
        }

        case 'rect': {
          // similar to the ellipse, we'll replace rect with polygon
          let polygon = this.svg.createElementNS(element.namespaceURI, 'polygon');

          const x = parseFloat(element.getAttribute('x')) || 0;
          const y = parseFloat(element.getAttribute('y')) || 0;
          const w = parseFloat(element.getAttribute('width'));
          const h = parseFloat(element.getAttribute('height'));

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

          element.parentElement.replaceChild(polygon, element);
          element = polygon;
          // Fallthrough to polygon handling
        }
        case 'polygon':
        case 'polyline': {
           // parse points
           const pointsVal = element.getAttribute('points');
           const pointsList = pointsVal.trim().split(/\s+|,/);
           const transformedPoints = [];
           
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

  flatten(element) {
    for (let i = 0; i < element.childNodes.length; i++) {
      this.flatten(element.childNodes[i]);
    }

    if (element.tagName != 'svg') {
      while (element.childNodes.length > 0) {
        element.parentElement.appendChild(element.childNodes[0]);
      }
    }
  }

  filter(whitelist, element) {
    if (!whitelist || whitelist.length == 0) {
      throw Error('invalid whitelist');
    }

    element = element || this.svgRoot;

    for (let i = 0; i < element.childNodes.length; i++) {
      this.filter(whitelist, element.childNodes[i]);
    }

    if (element.childNodes.length == 0 && whitelist.indexOf(element.tagName) < 0) {
      if (element.parentElement) {
          element.parentElement.removeChild(element);
      }
    }
  }

  splitPath(path) {
    if (!path || path.tagName != 'path' || !path.parentElement) {
      return false;
    }

    const d = path.getAttribute('d');
    if (!d) return false;
    
    // Use svgpath to iterate segments
    // We want to detect multiple M commands.
    
    const pathObj = svgpath(d).abs().unshort();
    const segs = [];
    pathObj.iterate((s, _i, _x, _y) => {
        segs.push({ cmd: s[0], params: s.slice(1) });
    });
    
    // Check if there is more than one M (that is not the first one)
    // Actually, svgpath treats 'm' as relative move, but .abs() makes it absolute 'M'.
    // If we have multiple M commands, it means we have subpaths.
    
    const subPaths = [];
    let currentSubPath = [];
    
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
        return false; // No split needed
    }
    
    const addedPaths = [];
    subPaths.forEach(sub => {
        // Construct d string for subpath
        // Need to be careful: svgpath segments are [cmd, p1, p2, ...]
        let newD = "";
        sub.forEach(s => {
           newD += s.cmd + " " + s.params.join(" ") + " "; 
        });
        
        const p = path.cloneNode();
        p.setAttribute('d', newD);
        path.parentElement.insertBefore(p, path);
        addedPaths.push(p);
    });
    
    path.remove();
    return addedPaths;
  }

  recurse(element, func) {
    const children = Array.prototype.slice.call(element.childNodes);
    for (let i = 0; i < children.length; i++) {
      this.recurse(children[i], func);
    }
    func(element);
  }

  polygonify(element) {
    const poly = [];

    switch (element.tagName) {
      case 'polygon':
      case 'polyline': {
        const pointsVal = element.getAttribute('points');
        const pointsList = pointsVal.trim().split(/\s+|,/);
        for(let i=0; i<pointsList.length; i+=2) {
             const px = parseFloat(pointsList[i]);
             const py = parseFloat(pointsList[i+1]);
             if(!isNaN(px) && !isNaN(py)) {
                 poly.push({x: px, y: py});
             }
        }
        break;
      }
        
      case 'rect': {
        const x = parseFloat(element.getAttribute('x')) || 0;
        const y = parseFloat(element.getAttribute('y')) || 0;
        const w = parseFloat(element.getAttribute('width'));
        const h = parseFloat(element.getAttribute('height'));
        
        poly.push({x: x, y: y});
        poly.push({x: x+w, y: y});
        poly.push({x: x+w, y: y+h});
        poly.push({x: x, y: y+h});
        break;
      }
        
      case 'circle': {
        const radius = parseFloat(element.getAttribute('r'));
        const cx = parseFloat(element.getAttribute('cx'));
        const cy = parseFloat(element.getAttribute('cy'));

        // num is the smallest number of segments required to approximate the circle to the given tolerance
        let num = Math.ceil((2 * Math.PI) / Math.acos(1 - (this.conf.tolerance / radius)));

        if (num < 3) {
          num = 3;
        }

        for (let i = 0; i < num; i++) {
          const theta = i * ((2 * Math.PI) / num);
          const point = {};
          point.x = radius * Math.cos(theta) + cx;
          point.y = radius * Math.sin(theta) + cy;

          poly.push(point);
        }
        break;
      }
        
      case 'ellipse': {
        const rx = parseFloat(element.getAttribute('rx'))
        const ry = parseFloat(element.getAttribute('ry'));
        const maxradius = Math.max(rx, ry);

        const cxEllipse = parseFloat(element.getAttribute('cx'));
        const cyEllipse = parseFloat(element.getAttribute('cy'));

        let numEllipse = Math.ceil((2 * Math.PI) / Math.acos(1 - (this.conf.tolerance / maxradius)));

        if (numEllipse < 3) {
          numEllipse = 3;
        }

        for (let i = 0; i < numEllipse; i++) {
          const theta = i * ((2 * Math.PI) / numEllipse);
          const point = {};
          point.x = rx * Math.cos(theta) + cxEllipse;
          point.y = ry * Math.sin(theta) + cyEllipse;

          poly.push(point);
        }
        break;
      }
        
      case 'path': {
        // we'll assume that splitpath has already been run on this path, and it only has one M/m command 
        const d = element.getAttribute('d');
        const pathObj = svgpath(d).abs().unshort();
        
        let x=0, y=0;
        
        pathObj.iterate((s, index, curX, curY) => {
            const command = s[0];
            const params = s.slice(1);
            
            // Update current position from iterator
            x = curX;
            y = curY;
            
            // Record start of subpath if M
            if(command === 'M') {
                // x0 = params[0];
                // y0 = params[1];
            }

            switch(command){
                case 'M':
                case 'L':
                    poly.push({x: params[0], y: params[1]});
                    break;
                case 'H':
                    poly.push({x: params[0], y: y});
                    break;
                case 'V':
                    poly.push({x: x, y: params[0]});
                    break;
                    
                case 'C': {
                    // C x1 y1 x2 y2 x y
                    const p1 = {x: x, y: y};
                    const c1 = {x: params[0], y: params[1]};
                    const c2 = {x: params[2], y: params[3]};
                    const p2 = {x: params[4], y: params[5]};
                    
                    const pts = GeometryUtil.CubicBezier.linearize(p1, p2, c1, c2, this.conf.tolerance);
                    pts.shift(); // remove start point
                    pts.forEach(p => poly.push(p));
                    break;
                }
                    
                case 'S':
                    // S x2 y2 x y
                    // implicit control point is reflection of previous C control point
                    // svgpath doesn't convert S to C for us unless we ask? .unshort() says "Converts ... S to C"
                    // Wait, .unshort() documentation: "Converts smooth curves (T, S) to generic ones (Q, C)."
                    // So we shouldn't see S if we called unshort().
                    // But just in case:
                    // const p1S = {x: x, y: y};
                    // if previous was C or S, reflect control point. But unshort handles this.
                    // Assuming unshort works, we shouldn't get S.
                    // But if we do, it's hard to track previous control point without keeping state.
                    // Since we called unshort(), I will assume it's C.
                    console.warn('Unexpected S command after unshort');
                    break;
                    
                case 'Q': {
                    // Q x1 y1 x y
                    const p1Q = {x: x, y: y};
                    const c1Q = {x: params[0], y: params[1]};
                    const p2Q = {x: params[2], y: params[3]};
                    
                    const ptsQ = GeometryUtil.QuadraticBezier.linearize(p1Q, p2Q, c1Q, this.conf.tolerance);
                    ptsQ.shift();
                    ptsQ.forEach(p => poly.push(p));
                    break;
                }
                    
                case 'T':
                     // Should be converted to Q by unshort()
                     console.warn('Unexpected T command after unshort');
                     break;
                     
                case 'A': {
                    // A rx ry angle large-arc-flag sweep-flag x y
                    const p1A = {x: x, y: y};
                    const p2A = {x: params[5], y: params[6]};
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
                    
                case 'Z':
                    // Close path
                    // x, y will become x0, y0 for next loop?
                    // actually Z doesn't have params.
                    // We might not need to push a point if it's already closed.
                    // The loop below handles coincident points.
                    break;
            }
        });
        
        break;
      }
    }

    // do not include last point if coincident with starting point
    while (poly.length > 0 && GeometryUtil.almostEqual(poly[0].x, poly[poly.length - 1].x, this.conf.toleranceSvg) && GeometryUtil.almostEqual(poly[0].y, poly[poly.length - 1].y, this.conf.toleranceSvg)) {
      poly.pop();
    }

    return poly;
  }
}

export default new SvgParser();
