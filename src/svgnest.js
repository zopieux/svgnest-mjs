import SvgParser from './util/parser.js';
import GeometryUtil from './util/geometry.js';
import GeneticAlgorithm from './genetic-algorithm.js';
import ClipperLib from './util/clipper.js';
import NestWorker from './util/nestWorker.js?worker';
import WebWorker from 'web-worker';

const WorkerCtor = (typeof Worker !== 'undefined') ? Worker : WebWorker;

export class SvgNest {
  constructor() {
    this.svg = null;
    this.style = null;
    this.parts = null;
    this.tree = null;
    this.bin = null;
    this.binPolygon = null;
    this.binBounds = null;
    this.nfpCache = {};
    this.configData = {
      clipperScale: 10000000,
      curveTolerance: 0.3,
      spacing: 0,
      rotations: 4,
      populationSize: 10,
      mutationRate: 10,
      useHoles: false,
      exploreConcave: false,
      workerUrl: null
    };

    this.working = false;
    this.GA = null;
    this.best = null;
    this.workerTimer = null;
    this.progress = 0;
    
    this.workers = [];
    this.workerQueue = [];
    this.activeTasks = 0;
  }

  parseSvg(svgstring) {
    // reset if in progress
    this.stop();

    this.bin = null;
    this.binPolygon = null;
    this.tree = null;

    // parse svg
    this.svg = SvgParser.load(svgstring);

    this.style = SvgParser.getStyle();

    this.svg = SvgParser.cleanInput();

    this.tree = this.getParts(this.svg.childNodes);

    return this.svg;
  }

  setBin(element) {
    if (!this.svg) {
      return;
    }
    this.bin = element;
  }

  config(c) {
    // clean up inputs
    if (!c) {
      return this.configData;
    }

    if (c.curveTolerance && !GeometryUtil.almostEqual(parseFloat(c.curveTolerance), 0)) {
      this.configData.curveTolerance = parseFloat(c.curveTolerance);
    }

    if ('spacing' in c) {
      this.configData.spacing = parseFloat(c.spacing);
    }

    if (c.rotations && parseInt(c.rotations) > 0) {
      this.configData.rotations = parseInt(c.rotations);
    }

    if (c.populationSize && parseInt(c.populationSize) > 2) {
      this.configData.populationSize = parseInt(c.populationSize);
    }

    if (c.mutationRate && parseInt(c.mutationRate) > 0) {
      this.configData.mutationRate = parseInt(c.mutationRate);
    }

    if ('useHoles' in c) {
      this.configData.useHoles = !!c.useHoles;
    }

    if ('exploreConcave' in c) {
      this.configData.exploreConcave = !!c.exploreConcave;
    }
    
    if ('clipperScale' in c) {
        this.configData.clipperScale = parseFloat(c.clipperScale);
    }
    
    if ('workerUrl' in c) {
        this.configData.workerUrl = c.workerUrl;
    }

    SvgParser.config({ tolerance: this.configData.curveTolerance });

    this.best = null;
    this.nfpCache = {};
    this.binPolygon = null;
    this.GA = null;

    return this.configData;
  }

  start(progressCallback, displayCallback) {
    if (!this.svg || !this.bin) {
      return false;
    }

    this.parts = Array.prototype.slice.call(this.svg.childNodes);
    const binindex = this.parts.indexOf(this.bin);

    if (binindex >= 0) {
      // don't process bin as a part of the tree
      this.parts.splice(binindex, 1);
    }

    // build tree without bin
    this.tree = this.getParts(this.parts.slice(0));

    this.offsetTree(this.tree, 0.5 * this.configData.spacing, this.polygonOffset.bind(this));

    this.binPolygon = SvgParser.polygonify(this.bin);
    this.binPolygon = this.cleanPolygon(this.binPolygon);

    if (!this.binPolygon || this.binPolygon.length < 3) {
      return false;
    }

    this.binBounds = GeometryUtil.getPolygonBounds(this.binPolygon);

    if (this.configData.spacing > 0) {
      const offsetBin = this.polygonOffset(this.binPolygon, -0.5 * this.configData.spacing);
      if (offsetBin.length == 1) {
        // if the offset contains 0 or more than 1 path, something went wrong.
        this.binPolygon = offsetBin.pop();
      }
    }

    this.binPolygon.id = -1;

    // put bin on origin
    let xbinmax = this.binPolygon[0].x;
    let xbinmin = this.binPolygon[0].x;
    let ybinmax = this.binPolygon[0].y;
    let ybinmin = this.binPolygon[0].y;

    for (let i = 1; i < this.binPolygon.length; i++) {
      if (this.binPolygon[i].x > xbinmax) {
        xbinmax = this.binPolygon[i].x;
      }
      else if (this.binPolygon[i].x < xbinmin) {
        xbinmin = this.binPolygon[i].x;
      }
      if (this.binPolygon[i].y > ybinmax) {
        ybinmax = this.binPolygon[i].y;
      }
      else if (this.binPolygon[i].y < ybinmin) {
        ybinmin = this.binPolygon[i].y;
      }
    }

    for (let i = 0; i < this.binPolygon.length; i++) {
      this.binPolygon[i].x -= xbinmin;
      this.binPolygon[i].y -= ybinmin;
    }

    this.binPolygon.width = xbinmax - xbinmin;
    this.binPolygon.height = ybinmax - ybinmin;

    // all paths need to have the same winding direction
    if (GeometryUtil.polygonArea(this.binPolygon) > 0) {
      this.binPolygon.reverse();
    }

    // remove duplicate endpoints, ensure counterclockwise winding direction
    for (let i = 0; i < this.tree.length; i++) {
      const start = this.tree[i][0];
      const end = this.tree[i][this.tree[i].length - 1];
      if (start == end || (GeometryUtil.almostEqual(start.x, end.x) && GeometryUtil.almostEqual(start.y, end.y))) {
        this.tree[i].pop();
      }

      if (GeometryUtil.polygonArea(this.tree[i]) > 0) {
        this.tree[i].reverse();
      }
    }
    
    // Initialize workers
    this.initWorkers();

    const self = this;
    this.working = false;

    this.workerTimer = setInterval(function () {
      if (!self.working) {
        self.launchWorkers(self.tree, self.binPolygon, self.configData, progressCallback, displayCallback);
        self.working = true;
      }

      progressCallback(self.progress);
    }, 100);
    
    return true;
  }
  
  initWorkers() {
      // terminate existing
      this.workers.forEach(w => w.terminate());
      this.workers = [];
      
      const concurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
      
      for(let i=0; i<concurrency; i++) {
          let worker;
          if (this.configData.workerUrl) {
              worker = new WorkerCtor(this.configData.workerUrl, { type: 'module' });
          } else {
              worker = new NestWorker();
          }
          
          worker.onmessage = this.handleWorkerMessage.bind(this, worker);
          worker.busy = false;
          this.workers.push(worker);
      }
  }
  
  handleWorkerMessage(worker, e) {
      worker.busy = false;
      this.activeTasks--;
      const { id, result, error } = e.data;
      
      const taskCallback = this.workerQueue[id];
      if (taskCallback) {
          delete this.workerQueue[id];
          taskCallback(error, result);
      }
      
      // Process next task if any (not really using a queue for now, just direct dispatch)
      this.processQueue();
  }
  
  runTask(type, data, cb) {
      // Find free worker
      const worker = this.workers.find(w => !w.busy);
      if (worker) {
          worker.busy = true;
          this.activeTasks++;
          const id = Math.random().toString(36).substring(7);
          this.workerQueue[id] = cb;
          worker.postMessage({ type, data, id });
      } else {
          // Queue the task
          const id = Math.random().toString(36).substring(7);
          this.workerQueue[id] = cb;
          this.pendingTasks = this.pendingTasks || [];
          this.pendingTasks.push({ type, data, id });
          // processQueue will be called when a worker becomes free
      }
  }
  
  processQueue() {
      if (!this.pendingTasks || this.pendingTasks.length === 0) return;
      
      const worker = this.workers.find(w => !w.busy);
      if (!worker) return;
      
      const task = this.pendingTasks.shift();
      worker.busy = true;
      this.activeTasks++;
      worker.postMessage(task);
      // Try to process more if more workers available
      this.processQueue();
  }
  
  // Custom implementation of Parallel.map
  runParallelMap(dataList, type, env) {
      return new Promise((resolve, reject) => {
          const results = new Array(dataList.length);
          let completed = 0;
          let hasError = false;
          
          if (dataList.length === 0) {
              resolve([]);
              return;
          }

          dataList.forEach((item, index) => {
              // Construct data payload based on type
              // For NFP: item is pair.
              // For Place: item is paths, and we need env config.
              
              let payload = item;
              if (type === 'place') {
                 // item is list of paths
                 // env contains: binPolygon, ids, rotations, config, nfpCache
                 payload = {
                     paths: item,
                     ...env
                 };
              } else if (type === 'nfp') {
                 // item is pair
                 // env contains: searchEdges, useHoles
                 payload = {
                     pair: item,
                     ...env
                 };
              }

              this.runTask(type, payload, (err, res) => {
                  if (hasError) return;
                  if (err) {
                      hasError = true;
                      reject(err);
                      return;
                  }
                  results[index] = res;
                  completed++;
                  
                  // Progress update for NFP
                  if(type === 'nfp' && this.onProgress) {
                      this.onProgress(completed / dataList.length);
                  }
                  
                  if (completed === dataList.length) {
                      resolve(results);
                  }
              });
          });
      });
  }


  launchWorkers(tree, binPolygon, config, progressCallback, displayCallback) {
    this.onProgress = progressCallback;

    if (this.GA === null) {
      // initiate new GA
      const adam = tree.slice(0);

      // seed with decreasing area
      adam.sort(function (a, b) {
        return Math.abs(GeometryUtil.polygonArea(b)) - Math.abs(GeometryUtil.polygonArea(a));
      });

      this.GA = new GeneticAlgorithm(adam, binPolygon, config);
    }

    let individual = null;

    // evaluate all members of the population
    for (let i = 0; i < this.GA.population.length; i++) {
      if (!this.GA.population[i].fitness) {
        individual = this.GA.population[i];
        break;
      }
    }

    if (individual === null) {
      // all individuals have been evaluated, start next generation
      this.GA.generation();
      individual = this.GA.population[1];
    }

    const placelist = individual.placement;
    const rotations = individual.rotation;

    const ids = [];
    for (let i = 0; i < placelist.length; i++) {
      ids.push(placelist[i].id);
      placelist[i].rotation = rotations[i];
    }

    const nfpPairs = [];
    let key;
    const newCache = {};

    for (let i = 0; i < placelist.length; i++) {
      const part = placelist[i];
      key = { A: binPolygon.id, B: part.id, inside: true, Arotation: 0, Brotation: rotations[i] };
      if (!this.nfpCache[JSON.stringify(key)]) {
        nfpPairs.push({ A: binPolygon, B: part, key: key });
      }
      else {
        newCache[JSON.stringify(key)] = this.nfpCache[JSON.stringify(key)]
      }
      for (let j = 0; j < i; j++) {
        const placed = placelist[j];
        key = { A: placed.id, B: part.id, inside: false, Arotation: rotations[j], Brotation: rotations[i] };
        if (!this.nfpCache[JSON.stringify(key)]) {
          nfpPairs.push({ A: placed, B: part, key: key });
        }
        else {
          newCache[JSON.stringify(key)] = this.nfpCache[JSON.stringify(key)]
        }
      }
    }

    // only keep cache for one cycle
    this.nfpCache = newCache;

    // Run NFP generation
    this.runParallelMap(nfpPairs, 'nfp', {
        searchEdges: config.exploreConcave,
        useHoles: config.useHoles
    }).then((generatedNfp) => {
        if (generatedNfp) {
          for (let i = 0; i < generatedNfp.length; i++) {
            const Nfp = generatedNfp[i];

            if (Nfp) {
              // a null nfp means the nfp could not be generated, either because the parts simply don't fit or an error in the nfp algo
              const key = JSON.stringify(Nfp.key);
              this.nfpCache[key] = Nfp.value;
            }
          }
        }
        
        // Run Placement
        // The original code passed [placelist] to Parallel, effectively running it once.
        // We do the same.
        
        const placementEnv = {
            binPolygon: binPolygon,
            ids: ids,
            rotations: rotations,
            config: config,
            nfpCache: this.nfpCache
        };
        
        return this.runParallelMap([placelist.slice(0)], 'place', placementEnv);
    }).then((placements) => {
        if (!placements || placements.length == 0) {
            return;
        }

        individual.fitness = placements[0].fitness;
        let bestresult = placements[0];

        for (let i = 1; i < placements.length; i++) {
            if (placements[i].fitness < bestresult.fitness) {
                bestresult = placements[i];
            }
        }

        if (!this.best || bestresult.fitness < this.best.fitness) {
            this.best = bestresult;

            let placedArea = 0;
            let totalArea = 0;
            const numParts = placelist.length;
            let numPlacedParts = 0;

            for (let i = 0; i < this.best.placements.length; i++) {
                totalArea += Math.abs(GeometryUtil.polygonArea(binPolygon));
                for (let j = 0; j < this.best.placements[i].length; j++) {
                    placedArea += Math.abs(GeometryUtil.polygonArea(this.tree[this.best.placements[i][j].id]));
                    numPlacedParts++;
                }
            }
            displayCallback(this.applyPlacement(this.best.placements), placedArea / totalArea, numPlacedParts, numParts);
        }
        else {
            displayCallback();
        }
        this.working = false;
    }).catch((err) => {
        console.error(err);
        this.working = false;
    });
  }

  offsetTree(t, offset, offsetFunction) {
    for (let i = 0; i < t.length; i++) {
      const offsetpaths = offsetFunction(t[i], offset);
      if (offsetpaths.length == 1) {
        // replace array items in place
        Array.prototype.splice.apply(t[i], [0, t[i].length].concat(offsetpaths[0]));
      }

      if (t[i].childNodes && t[i].childNodes.length > 0) {
        this.offsetTree(t[i].childNodes, -offset, offsetFunction);
      }
    }
  }
  
  getParts(paths) {
    const polygons = [];

    const numChildren = paths.length;
    for (let i = 0; i < numChildren; i++) {
      let poly = SvgParser.polygonify(paths[i]);
      poly = this.cleanPolygon(poly);

      // todo: warn user if poly could not be processed and is excluded from the nest
      if (poly && poly.length > 2 && Math.abs(GeometryUtil.polygonArea(poly)) > this.configData.curveTolerance * this.configData.curveTolerance) {
        poly.source = i;
        polygons.push(poly);
      }
    }

    // turn the list into a tree
    toTree(polygons);

    function toTree(list, idstart) {
      const parents = [];
      let id = idstart || 0;

      for (let i = 0; i < list.length; i++) {
        const p = list[i];

        let ischild = false;
        for (let j = 0; j < list.length; j++) {
          if (j == i) {
            continue;
          }
          if (GeometryUtil.pointInPolygon(p[0], list[j]) === true) {
            if (!list[j].children) {
              list[j].children = [];
            }
            list[j].children.push(p);
            p.parent = list[j];
            ischild = true;
            break;
          }
        }

        if (!ischild) {
          parents.push(p);
        }
      }

      for (let i = 0; i < list.length; i++) {
        if (parents.indexOf(list[i]) < 0) {
          list.splice(i, 1);
          i--;
        }
      }

      for (let i = 0; i < parents.length; i++) {
        parents[i].id = id;
        id++;
      }

      for (let i = 0; i < parents.length; i++) {
        if (parents[i].children) {
          id = toTree(parents[i].children, id);
        }
      }

      return id;
    };

    return polygons;
  }

  polygonOffset(polygon, offset) {
    if (!offset || offset == 0 || GeometryUtil.almostEqual(offset, 0)) {
      return polygon;
    }

    const p = this.svgToClipper(polygon);

    const miterLimit = 2;
    const co = new ClipperLib.ClipperOffset(miterLimit, this.configData.curveTolerance * this.configData.clipperScale);
    co.AddPath(p, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);

    const newpaths = new ClipperLib.Paths();
    co.Execute(newpaths, offset * this.configData.clipperScale);

    const result = [];
    for (let i = 0; i < newpaths.length; i++) {
      result.push(this.clipperToSvg(newpaths[i]));
    }

    return result;
  }

  cleanPolygon(polygon) {
    const p = this.svgToClipper(polygon);
    // remove self-intersections and find the biggest polygon that's left
    const simple = ClipperLib.Clipper.SimplifyPolygon(p, ClipperLib.PolyFillType.pftNonZero);

    if (!simple || simple.length == 0) {
      return null;
    }

    let biggest = simple[0];
    let biggestarea = Math.abs(ClipperLib.Clipper.Area(biggest));
    for (let i = 1; i < simple.length; i++) {
      const area = Math.abs(ClipperLib.Clipper.Area(simple[i]));
      if (area > biggestarea) {
        biggest = simple[i];
        biggestarea = area;
      }
    }

    // clean up singularities, coincident points and edges
    const clean = ClipperLib.Clipper.CleanPolygon(biggest, this.configData.curveTolerance * this.configData.clipperScale);

    if (!clean || clean.length == 0) {
      return null;
    }

    return this.clipperToSvg(clean);
  }

  svgToClipper(polygon) {
    const clip = [];
    for (let i = 0; i < polygon.length; i++) {
      clip.push({ X: polygon[i].x, Y: polygon[i].y });
    }

    ClipperLib.JS.ScaleUpPath(clip, this.configData.clipperScale);

    return clip;
  }

  clipperToSvg(polygon) {
    const normal = [];

    for (let i = 0; i < polygon.length; i++) {
      normal.push({ x: polygon[i].X / this.configData.clipperScale, y: polygon[i].Y / this.configData.clipperScale });
    }

    return normal;
  }

  applyPlacement(placement) {
    const clone = [];
    for (let i = 0; i < this.parts.length; i++) {
      clone.push(this.parts[i].cloneNode(false));
    }

    const svglist = [];

    for (let i = 0; i < placement.length; i++) {
      const newsvg = this.svg.cloneNode(false);
      newsvg.setAttribute('viewBox', '0 0 ' + this.binBounds.width + ' ' + this.binBounds.height);
      newsvg.setAttribute('width', this.binBounds.width + 'px');
      newsvg.setAttribute('height', this.binBounds.height + 'px');
      const binclone = this.bin.cloneNode(false);

      binclone.setAttribute('class', 'bin');
      binclone.setAttribute('transform', 'translate(' + (-this.binBounds.x) + ' ' + (-this.binBounds.y) + ')');
      newsvg.appendChild(binclone);

      for (let j = 0; j < placement[i].length; j++) {
        const p = placement[i][j];
        const part = this.tree[p.id];

        // the original path could have transforms and stuff on it, so apply our transforms on a group
        const partgroup = document.createElementNS(this.svg.namespaceURI, 'g');
        partgroup.setAttribute('transform', 'translate(' + p.x + ' ' + p.y + ') rotate(' + p.rotation + ')');
        partgroup.appendChild(clone[part.source]);

        if (part.children && part.children.length > 0) {
          const flattened = this.flattenTree(part.children, true);
          for (let k = 0; k < flattened.length; k++) {

            const c = clone[flattened[k].source];
            // add class to indicate hole
            if (flattened[k].hole && (!c.getAttribute('class') || c.getAttribute('class').indexOf('hole') < 0)) {
              c.setAttribute('class', c.getAttribute('class') + ' hole');
            }
            partgroup.appendChild(c);
          }
        }

        newsvg.appendChild(partgroup);
      }

      svglist.push(newsvg);
    }

    return svglist;
  }
  
  flattenTree(t, hole) {
    let flat = [];
    for (let i = 0; i < t.length; i++) {
      flat.push(t[i]);
      t[i].hole = hole;
      if (t[i].children && t[i].children.length > 0) {
        flat = flat.concat(this.flattenTree(t[i].children, !hole));
      }
    }

    return flat;
  }

  stop() {
    this.working = false;
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
    }
    // Terminate workers?
    // Maybe keep them around for restart?
    // But `parsesvg` resets everything.
  }
}

export default SvgNest;