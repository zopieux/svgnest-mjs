export interface Point {
  X: number;
  Y: number;
}

export interface Polygon extends Array<Point> {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: Polygon[];
  id?: number;
  source?: number;
  rotation?: number;
  hole?: boolean;
  parent?: Polygon;
}

export interface Config {
  clipperScale: number;
  curveTolerance: number;
  spacing: number;
  rotations: number;
  populationSize: number;
  mutationRate: number;
  useHoles: boolean;
  exploreConcave: boolean;
  workerUrl: string | null;
}

export interface Placement {
  x: number;
  y: number;
  id: number;
  rotation: number;
  nfp?: Point[][];
}

export interface Result {
  placements: Placement[][];
  fitness: number;
  paths: Polygon[];
  area: number;
}
