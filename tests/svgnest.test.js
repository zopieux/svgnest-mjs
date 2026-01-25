import { describe, it, expect } from 'vitest';
import SvgNest from '../src/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, 'outputs');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

describe('Core Algorithm', () => {
  const readSvg = (filename) => {
    return fs.readFileSync(path.resolve(__dirname, filename), 'utf8');
  };

  const writeOutput = (name, svgList) => {
      if (!svgList) return;
      svgList.forEach((svg, index) => {
          const filename = `${name}_${index}.svg`;
          const filepath = path.join(outputDir, filename);
          // svg is a DOM element in JSDOM environment
          const content = svg.outerHTML; 
          fs.writeFileSync(filepath, content);
      });
  };

  it('should place all simple rectangles in a larger bin', async () => {
    const svg = `
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect id="bin" x="0" y="0" width="100" height="100" fill="none" stroke="black" />
        <rect x="0" y="0" width="20" height="20" fill="red" />
        <rect x="0" y="0" width="20" height="20" fill="green" />
        <rect x="0" y="0" width="20" height="20" fill="blue" />
      </svg>
    `;
    const nest = new SvgNest();
    const root = nest.parseSvg(svg);
    nest.setBin(root.querySelector('#bin'));
    
    const workerUrl = path.resolve(__dirname, '../src/util/nestWorker.js');
    nest.config({
        populationSize: 2,
        rotations: 1,
        workerUrl
    });

    const result = await new Promise((resolve) => {
        nest.start(() => {}, (svgList, efficiency, placedParts, totalParts) => {
            if (svgList) {
                nest.stop();
                resolve({ svgList, placedParts, totalParts });
            }
        });
    });

    writeOutput('simple_rects', result.svgList);

    expect(result.placedParts).toBe(3);
    expect(result.totalParts).toBe(3);
  });

  it('should place many shapes (stress test)', async () => {
    const svg = readSvg('stress.svg');
    const nest = new SvgNest();
    const root = nest.parseSvg(svg);
    nest.setBin(root.querySelector('#bin'));
    
    const workerUrl = path.resolve(__dirname, '../src/util/nestWorker.js');
    nest.config({
      spacing: 0,
      curveTolerance: 0.3,
      rotations: 4,
      populationSize: 10,
      mutationRate: 10,
      useHoles: false,
      exploreConcave: false,
      workerUrl
    });

    const result = await new Promise((resolve) => {
        nest.start(() => {}, (svgList, efficiency, placedParts, totalParts) => {
            if (svgList) {
                nest.stop();
                resolve({ svgList, placedParts, totalParts });
            }
        });
    });

    writeOutput('stress_test', result.svgList);

    expect(result.placedParts).toBe(result.totalParts);
    expect(result.totalParts).toBeGreaterThan(0);
  }, 20000);

  it('should handle concave shapes (L-shape)', async () => {
    const svg = `
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect id="bin" x="0" y="0" width="100" height="100" fill="none" stroke="black" />
        <polygon points="0,0 20,0 20,10 10,10 10,20 0,20" />
        <polygon points="0,0 20,0 20,10 10,10 10,20 0,20" />
        <polygon points="0,0 20,0 20,10 10,10 10,20 0,20" />
      </svg>
    `;
    const nest = new SvgNest();
    const root = nest.parseSvg(svg);
    nest.setBin(root.querySelector('#bin'));
    
    const workerUrl = path.resolve(__dirname, '../src/util/nestWorker.js');
    nest.config({ populationSize: 2, rotations: 4, exploreConcave: true, workerUrl });

    const result = await new Promise((resolve) => {
        nest.start(() => {}, (svgList, efficiency, placedParts, totalParts) => {
            if (svgList) {
                nest.stop();
                resolve({ svgList, placedParts, totalParts });
            }
        });
    });

    writeOutput('concave_shapes', result.svgList);

    expect(result.placedParts).toBe(3);
  });

  it('should use multiple bins if shapes do not fit in one', async () => {
    const svg = `
      <svg viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
        <rect id="bin" x="0" y="0" width="30" height="30" fill="none" stroke="black" />
        <rect x="0" y="0" width="25" height="25" />
        <rect x="0" y="0" width="25" height="25" />
      </svg>
    `;
    const nest = new SvgNest();
    const root = nest.parseSvg(svg);
    nest.setBin(root.querySelector('#bin'));
    
    const workerUrl = path.resolve(__dirname, '../src/util/nestWorker.js');
    nest.config({ populationSize: 2, rotations: 1, workerUrl });

    const result = await new Promise((resolve) => {
        nest.start(() => {}, (svgList, efficiency, placedParts, totalParts) => {
            if (svgList) {
                nest.stop();
                resolve({ svgList, placedParts, totalParts });
            }
        });
    });

    writeOutput('multiple_bins', result.svgList);

    expect(result.svgList.length).toBe(2);
    expect(result.placedParts).toBe(2);
  });

  it('should handle path elements (paths.svg)', async () => {
    let svg = readSvg('paths.svg');
    // Add a bin to the SVG
    svg = svg.replace('</svg>', '<rect id="bin" x="0" y="0" width="500" height="500" fill="none" stroke="black" /></svg>');
    
    const nest = new SvgNest();
    const root = nest.parseSvg(svg);
    nest.setBin(root.querySelector('#bin'));
    
    const workerUrl = path.resolve(__dirname, '../src/util/nestWorker.js');
    nest.config({
      spacing: 0,
      curveTolerance: 0.3,
      rotations: 1,
      populationSize: 4,
      workerUrl
    });

    const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Test timed out')), 10000);
        nest.start(() => {}, (svgList, efficiency, placedParts, totalParts) => {
            if (svgList) {
                clearTimeout(timeout);
                nest.stop();
                resolve({ svgList, placedParts, totalParts });
            }
        });
    });

    writeOutput('paths', result.svgList);

    expect(result.placedParts).toBeGreaterThan(0);
    expect(result.totalParts).toBeGreaterThan(0);
  });
});

describe('SvgNest API Edge Cases', () => {
  it('should return false if starting without SVG or bin', () => {
    const nest = new SvgNest();
    expect(nest.start()).toBe(false);
  });

  it('should throw error on invalid SVG string', () => {
    const nest = new SvgNest();
    expect(() => nest.parseSvg('not an svg')).toThrow();
  });
});