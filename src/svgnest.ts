import SvgParser from './util/parser.js';
import GeometryUtil from './util/geometry.js';
import GeneticAlgorithm, { Individual } from './genetic-algorithm.js';
import ClipperLib from 'js-clipper';
// @ts-ignore
import SvgWorker from './util/worker.js?worker';
import WebWorker from 'web-worker';
import { Point, Polygon, Config, Placement, Result } from './types.js';

const WorkerCtor = (typeof Worker !== 'undefined') ? Worker : WebWorker;

interface WorkerWithStatus extends Worker {
  busy?: boolean;
}

export class SvgNest {
  private svg: SVGSVGElement | null = null;
  private parts: Element[] | null = null;
  private tree: Polygon[] | null = null;
  private bin: Element | null = null;
  private binPolygon: Polygon | null = null;
  private binBounds: { x: number; y: number; width: number; height: number } | null = null;
  private nfpCache: Record<string, Point[][]> = {};
  private configData: Config = {
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

  private working = false;
  private GA: GeneticAlgorithm | null = null;
  private best: Result | null = null;
  private workerTimer: ReturnType<typeof setInterval> | null = null;
  private progress = 0;
  
  private workers: WorkerWithStatus[] = [];
  private workerQueue: Record<string, (err: any, res: any) => void> = {};
  private activeTasks = 0;
  private pendingTasks: { type: string; data: any; id: string }[] = [];
  private onProgress: ((p: number) => void) | null = null;

  constructor() {
    this.svg = null;
    this.parts = null;
    this.tree = null;
    this.bin = null;
    this.binPolygon = null;
    this.binBounds = null;
    this.nfpCache = {};
    this.working = false;
    this.GA = null;
    this.best = null;
    this.workerTimer = null;
    this.progress = 0;
  }

  parseSvg(svgstring: string): SVGSVGElement {
    this.stop();

    this.bin = null;
    this.binPolygon = null;
    this.tree = null;

    this.svg = SvgParser.load(svgstring);
    this.svg = SvgParser.cleanInput();
    this.tree = this.getParts(Array.from(this.svg.childNodes) as Element[]);

    return this.svg;
  }

  setBin(element: Element): void {
    if (!this.svg) {
      return;
    }
    this.bin = element;
  }

  config(c?: Partial<Config>): Config {
    if (!c) {
      return this.configData;
    }

    if (c.curveTolerance !== undefined && !GeometryUtil.almostEqual(c.curveTolerance, 0)) {
      this.configData.curveTolerance = c.curveTolerance;
    }

    if (c.spacing !== undefined) {
      this.configData.spacing = c.spacing;
    }

    if (c.rotations !== undefined && c.rotations > 0) {
      this.configData.rotations = c.rotations;
    }

    if (c.populationSize !== undefined && c.populationSize > 2) {
      this.configData.populationSize = c.populationSize;
    }

    if (c.mutationRate !== undefined && c.mutationRate > 0) {
      this.configData.mutationRate = c.mutationRate;
    }

    if (c.useHoles !== undefined) {
      this.configData.useHoles = !!c.useHoles;
    }

    if (c.exploreConcave !== undefined) {
      this.configData.exploreConcave = !!c.exploreConcave;
    }
    
    if (c.clipperScale !== undefined) {
        this.configData.clipperScale = c.clipperScale;
    }
    
    if (c.workerUrl !== undefined) {
        this.configData.workerUrl = c.workerUrl;
    }

    SvgParser.config({ tolerance: this.configData.curveTolerance });

    this.best = null;
    this.nfpCache = {};
    this.binPolygon = null;
    this.GA = null;

    return this.configData;
  }

  start(progressCallback: (p: number) => void, displayCallback: (svgs?: SVGSVGElement[], fitness?: number, numPlaced?: number, total?: number) => void): boolean {
    if (!this.svg || !this.bin) {
      return false;
    }

    this.parts = Array.from(this.svg.childNodes) as Element[];
    const binindex = this.parts.indexOf(this.bin);

    if (binindex >= 0) {
      this.parts.splice(binindex, 1);
    }

    this.tree = this.getParts(this.parts.slice(0));

    this.offsetTree(this.tree, 0.5 * this.configData.spacing, this.polygonOffset.bind(this));

    const binPoly = SvgParser.polygonify(this.bin);
    const cleanedBin = this.cleanPolygon(binPoly as Polygon);
    if (!cleanedBin || cleanedBin.length < 3) {
      return false;
    }

    this.binPolygon = cleanedBin as Polygon;
    this.binBounds = GeometryUtil.getPolygonBounds(this.binPolygon);

    if (this.configData.spacing > 0) {
      const offsetBin = this.polygonOffset(this.binPolygon, -0.5 * this.configData.spacing);
      if (offsetBin.length === 1) {
        this.binPolygon = offsetBin.pop() as Polygon;
      }
    }

    this.binPolygon.id = -1;

    let xbinmax = this.binPolygon[0].X;
    let xbinmin = this.binPolygon[0].X;
    let ybinmax = this.binPolygon[0].Y;
    let ybinmin = this.binPolygon[0].Y;

    for (let i = 1; i < this.binPolygon.length; i++) {
      if (this.binPolygon[i].X > xbinmax) xbinmax = this.binPolygon[i].X;
      else if (this.binPolygon[i].X < xbinmin) xbinmin = this.binPolygon[i].X;
      if (this.binPolygon[i].Y > ybinmax) ybinmax = this.binPolygon[i].Y;
      else if (this.binPolygon[i].Y < ybinmin) ybinmin = this.binPolygon[i].Y;
    }

    for (let i = 0; i < this.binPolygon.length; i++) {
      this.binPolygon[i].X -= xbinmin;
      this.binPolygon[i].Y -= ybinmin;
    }

    this.binPolygon.width = xbinmax - xbinmin;
    this.binPolygon.height = ybinmax - ybinmin;

    if (GeometryUtil.polygonArea(this.binPolygon) > 0) {
      this.binPolygon.reverse();
    }

    for (let i = 0; i < this.tree.length; i++) {
      const start = this.tree[i][0];
      const end = this.tree[i][this.tree[i].length - 1];
      if (start === end || (GeometryUtil.almostEqual(start.X, end.X) && GeometryUtil.almostEqual(start.Y, end.Y))) {
        this.tree[i].pop();
      }

      if (GeometryUtil.polygonArea(this.tree[i]) > 0) {
        this.tree[i].reverse();
      }
    }
    
    this.initWorkers();

    const self = this;
    this.working = false;

    this.workerTimer = setInterval(() => {
      if (!self.working && self.tree && self.binPolygon) {
        self.launchWorkers(self.tree, self.binPolygon, self.configData, progressCallback, displayCallback);
        self.working = true;
      }

      progressCallback(self.progress);
    }, 100);
    
    return true;
  }
  
  initWorkers(): void {
      this.workers.forEach(w => w.terminate());
      this.workers = [];
      
      const concurrency = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
      
      for(let i=0; i<concurrency; i++) {
          let worker: WorkerWithStatus;
          if (this.configData.workerUrl) {
              worker = new WorkerCtor(this.configData.workerUrl, { type: 'module' });
          } else {
              worker = new SvgWorker();
          }
          
          worker.onmessage = this.handleWorkerMessage.bind(this, worker);
          worker.busy = false;
          this.workers.push(worker);
      }
  }
  
  handleWorkerMessage(worker: WorkerWithStatus, e: MessageEvent): void {
      worker.busy = false;
      this.activeTasks--;
      const { id, result, error } = e.data;
      
      const taskCallback = this.workerQueue[id];
      if (taskCallback) {
          delete this.workerQueue[id];
          taskCallback(error, result);
      }
      
      this.processQueue();
  }
  
  runTask(type: string, data: any, cb: (err: any, res: any) => void): void {
      const worker = this.workers.find(w => !w.busy);
      const id = Math.random().toString(36).substring(7);
      if (worker) {
          worker.busy = true;
          this.activeTasks++;
          this.workerQueue[id] = cb;
          worker.postMessage({ type, data, id });
      } else {
          this.workerQueue[id] = cb;
          this.pendingTasks.push({ type, data, id });
      }
  }
  
  processQueue(): void {
      if (this.pendingTasks.length === 0) return;
      
      const worker = this.workers.find(w => !w.busy);
      if (!worker) return;
      
      const task = this.pendingTasks.shift();
      if (task) {
        worker.busy = true;
        this.activeTasks++;
        worker.postMessage(task);
        this.processQueue();
      }
  }
  
  runParallelMap(dataList: any[], type: string, env: any): Promise<any[]> {
      return new Promise((resolve, reject) => {
          const results = new Array(dataList.length);
          let completed = 0;
          let hasError = false;
          
          if (dataList.length === 0) {
              resolve([]);
              return;
          }

          dataList.forEach((item, index) => {
              let payload = item;
              if (type === 'place') {
                  payload = {
                      paths: item,
                      ...env
                  };
              } else if (type === 'nfp') {
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


  launchWorkers(tree: Polygon[], binPolygon: Polygon, config: Config, progressCallback: (p: number) => void, displayCallback: (svgs?: SVGSVGElement[], fitness?: number, numPlaced?: number, total?: number) => void): void {
    this.onProgress = progressCallback;

    if (this.GA === null) {
      const adam = tree.slice(0);

      adam.sort((a, b) => {
        return Math.abs(GeometryUtil.polygonArea(b)) - Math.abs(GeometryUtil.polygonArea(a));
      });

      this.GA = new GeneticAlgorithm(adam, binPolygon, config);
    }

    let individual: Individual | null = null;

    for (let i = 0; i < this.GA.population.length; i++) {
      if (!this.GA.population[i].fitness) {
        individual = this.GA.population[i];
        break;
      }
    }

    if (individual === null) {
      this.GA.generation();
      individual = this.GA.population[1];
    }

    const placelist = individual.placement;
    const rotations = individual.rotation;

    const ids: number[] = [];
    for (let i = 0; i < placelist.length; i++) {
      ids.push(placelist[i].id!);
      placelist[i].rotation = rotations[i];
    }

    const nfpPairs = [];
    let key: any;
    const newCache: Record<string, Point[][]> = {};

    for (let i = 0; i < placelist.length; i++) {
      const part = placelist[i];
      key = { A: binPolygon.id, B: part.id, inside: true, Arotation: 0, Brotation: rotations[i] };
      const skey = JSON.stringify(key);
      if (!this.nfpCache[skey]) {
        nfpPairs.push({ A: binPolygon, B: part, key: key });
      }
      else {
        newCache[skey] = this.nfpCache[skey];
      }
      for (let j = 0; j < i; j++) {
        const placed = placelist[j];
        key = { A: placed.id, B: part.id, inside: false, Arotation: rotations[j], Brotation: rotations[i] };
        const sskey = JSON.stringify(key);
        if (!this.nfpCache[sskey]) {
          nfpPairs.push({ A: placed, B: part, key: key });
        }
        else {
          newCache[sskey] = this.nfpCache[sskey];
        }
      }
    }

    this.nfpCache = newCache;

    this.runParallelMap(nfpPairs, 'nfp', {
        searchEdges: config.exploreConcave,
        useHoles: config.useHoles
    }).then((generatedNfp) => {
        if (generatedNfp) {
          for (let i = 0; i < generatedNfp.length; i++) {
            const Nfp = generatedNfp[i];

            if (Nfp) {
              const key = JSON.stringify(Nfp.key);
              this.nfpCache[key] = Nfp.value;
            }
          }
        }
        
        const placementEnv = {
            binPolygon: binPolygon,
            ids: ids,
            rotations: rotations,
            config: config,
            nfpCache: this.nfpCache
        };
        
        return this.runParallelMap([placelist.slice(0)], 'place', placementEnv);
    }).then((placements) => {
        if (!placements || placements.length === 0 || !individual) {
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

            for (let i = 0; i < this.best!.placements.length; i++) {
                totalArea += Math.abs(GeometryUtil.polygonArea(binPolygon));
                for (let j = 0; j < this.best!.placements[i].length; j++) {
                  if (this.tree) {
                    placedArea += Math.abs(GeometryUtil.polygonArea(this.tree[this.best!.placements[i][j].id]));
                    numPlacedParts++;
                  }
                }
            }
            displayCallback(this.applyPlacement(this.best!.placements), placedArea / totalArea, numPlacedParts, numParts);
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

  offsetTree(t: Polygon[], offset: number, offsetFunction: (p: Polygon, o: number) => Polygon[]): void {
    for (let i = 0; i < t.length; i++) {
      const offsetpaths = offsetFunction(t[i], offset);
      if (offsetpaths.length === 1) {
        Array.prototype.splice.apply(t[i], ([0, t[i].length] as any).concat(offsetpaths[0]));
      }

      const anyT = t[i] as any;
      if (anyT.childNodes && anyT.childNodes.length > 0) {
        this.offsetTree(anyT.childNodes, -offset, offsetFunction);
      }
    }
  }
  
  getParts(nodes: Element[]): Polygon[] {
    const polygons: Polygon[] = [];

    for (let i = 0; i < nodes.length; i++) {
      let poly = SvgParser.polygonify(nodes[i]) as Polygon;
      poly = this.cleanPolygon(poly) as Polygon;

      if (poly && poly.length > 2 && Math.abs(GeometryUtil.polygonArea(poly)) > this.configData.curveTolerance * this.configData.curveTolerance) {
        poly.source = i;
        polygons.push(poly);
      }
    }

    toTree(polygons);

    function toTree(list: Polygon[], idstart?: number) {
      const parents: Polygon[] = [];
      let id = idstart || 0;

      for (let i = 0; i < list.length; i++) {
        const p = list[i];

        let ischild = false;
        for (let j = 0; j < list.length; j++) {
          if (j === i) {
            continue;
          }
          if (GeometryUtil.pointInPolygon(p[0], list[j]) === true) {
            if (!list[j].children) {
              list[j].children = [];
            }
            list[j].children!.push(p);
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
          id = toTree(parents[i].children!, id);
        }
      }

      return id;
    }

    return polygons;
  }

  polygonOffset(polygon: Polygon, offset: number): Polygon[] {
    if (!offset || offset === 0 || GeometryUtil.almostEqual(offset, 0)) {
      return [polygon];
    }

    const p = this.svgToClipper(polygon);

    const miterLimit = 2;
    const co = new ClipperLib.ClipperOffset(miterLimit, this.configData.curveTolerance * this.configData.clipperScale);
    co.AddPath(p, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);

    const newpaths = new ClipperLib.Paths();
    co.Execute(newpaths, offset * this.configData.clipperScale);

    const result: Polygon[] = [];
    for (let i = 0; i < (newpaths as any).length; i++) {
      result.push(this.clipperToSvg((newpaths as any)[i]));
    }

    return result;
  }

  cleanPolygon(polygon: Polygon): Polygon | null {
    const p = this.svgToClipper(polygon);
    const simple = ClipperLib.Clipper.SimplifyPolygon(p, ClipperLib.PolyFillType.pftNonZero);

    if (!simple || simple.length === 0) {
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

    const clean = ClipperLib.Clipper.CleanPolygon(biggest, this.configData.curveTolerance * this.configData.clipperScale);

    if (!clean || clean.length === 0) {
      return null;
    }

    return this.clipperToSvg(clean);
  }

  svgToClipper(polygon: Polygon): any[] {
    const clip = [];
    for (let i = 0; i < polygon.length; i++) {
      clip.push({ X: polygon[i].X, Y: polygon[i].Y });
    }

    ClipperLib.JS.ScaleUpPath(clip, this.configData.clipperScale);

    return clip;
  }

  clipperToSvg(polygon: any[]): Polygon {
    const normal = [] as unknown as Polygon;

    for (let i = 0; i < polygon.length; i++) {
      normal.push({ X: polygon[i].X / this.configData.clipperScale, Y: polygon[i].Y / this.configData.clipperScale });
    }

    return normal;
  }

  applyPlacement(placement: Placement[][]): SVGSVGElement[] {
    const clone: Element[] = [];
    if (!this.parts || !this.svg || !this.binPolygon || !this.bin || !this.binBounds) return [];
    
    for (let i = 0; i < this.parts.length; i++) {
      clone.push(this.parts[i].cloneNode(false) as Element);
    }

    const svglist: SVGSVGElement[] = [];

    for (let i = 0; i < placement.length; i++) {
      const newsvg = this.svg.cloneNode(false) as SVGSVGElement;
      newsvg.setAttribute('viewBox', '0 0 ' + this.binBounds.width + ' ' + this.binBounds.height);
      newsvg.setAttribute('width', this.binBounds.width + 'px');
      newsvg.setAttribute('height', this.binBounds.height + 'px');
      const binclone = this.bin.cloneNode(false) as Element;

      binclone.setAttribute('class', 'bin');
      binclone.setAttribute('transform', 'translate(' + (-this.binBounds.x) + ' ' + (-this.binBounds.y) + ')');
      newsvg.appendChild(binclone);

      for (let j = 0; j < placement[i].length; j++) {
        const p = placement[i][j];
        if (!this.tree) continue;
        const part = this.tree[p.id];

        const partgroup = document.createElementNS(this.svg.namespaceURI, 'g');
        partgroup.setAttribute('transform', 'translate(' + p.x + ' ' + p.y + ') rotate(' + p.rotation + ')');
        partgroup.appendChild(clone[part.source!]);

        if (part.children && part.children.length > 0) {
          const flattened = this.flattenTree(part.children, true);
          for (let k = 0; k < flattened.length; k++) {
            const c = clone[flattened[k].source!] as Element;
            if (flattened[k].hole && (!c.getAttribute('class') || c.getAttribute('class')!.indexOf('hole') < 0)) {
              c.setAttribute('class', (c.getAttribute('class') || '') + ' hole');
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
  
  flattenTree(t: Polygon[], hole: boolean): Polygon[] {
    let flat: Polygon[] = [];
    for (let i = 0; i < t.length; i++) {
      flat.push(t[i]);
      t[i].hole = hole;
      const children = t[i].children;
      if (children && children.length > 0) {
        flat = flat.concat(this.flattenTree(children, !hole));
      }
    }

    return flat;
  }

  stop(): void {
    this.working = false;
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
    }
  }
}

export default SvgNest;
