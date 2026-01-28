import { describe, it, expect } from 'vitest';
import SvgNest from '../src/index.ts';
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
    
    const workerUrl = path.resolve(__dirname, '../dist/worker.js');
    nest.config({
        populationSize: 2,
        rotations: 1,
        workerUrl
    });

    const result = await new Promise((resolve) => {
        nest.start(() => {}, (svgList, efficiency, placedParts, totalParts) => {
            if (svgList) {
                nest.stop();
                resolve({ svgList, placedParts, totalParts, efficiency });
            }
        });
    });

    writeOutput('simple_rects', result.svgList);

    expect(result.placedParts).toBe(3);
    expect(result.totalParts).toBe(3);
    expect(result.svgList.length).toBe(1);
    expect(result.svgList[0].children.length).toBe(4); // 3 parts + 1 bin rect
  });

  it('should place many shapes (stress test)', async () => {
    const svg = readSvg('stress.svg');
    const nest = new SvgNest();
    const root = nest.parseSvg(svg);
    nest.setBin(root.querySelector('#bin'));
    
    const workerUrl = path.resolve(__dirname, '../dist/worker.js');
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
                resolve({ svgList, placedParts, totalParts, efficiency });
            }
        });
    });

    writeOutput('stress_test', result.svgList);

    expect(result.placedParts).toBe(142);
    expect(result.totalParts).toBe(142);
    expect(result.efficiency).toBeGreaterThan(0.528 * 0.95);
    expect(result.efficiency).toBeLessThan(0.528 * 1.05);
    expect(result.svgList.length).toBe(2);
    // Baseline: Bin 0 has ~88 parts (+1 rect), Bin 1 has ~54 parts (+1 rect). GA variance observed.
    const bin0Count = result.svgList[0].children.length;
    const bin1Count = result.svgList[1].children.length;
    expect(bin0Count).toBeGreaterThanOrEqual(75);
    expect(bin0Count).toBeLessThanOrEqual(100);
    expect(bin1Count).toBeGreaterThanOrEqual(45);
    expect(bin1Count).toBeLessThanOrEqual(70);
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
    
    const workerUrl = path.resolve(__dirname, '../dist/worker.js');
    nest.config({ populationSize: 2, rotations: 4, exploreConcave: true, workerUrl });

    const result = await new Promise((resolve) => {
        nest.start(() => {}, (svgList, efficiency, placedParts, totalParts) => {
            if (svgList) {
                nest.stop();
                resolve({ svgList, placedParts, totalParts, efficiency });
            }
        });
    });

    writeOutput('concave_shapes', result.svgList);

    expect(result.placedParts).toBe(3);
    expect(result.efficiency).toBeGreaterThan(0.09 * 0.95);
    expect(result.efficiency).toBeLessThan(0.09 * 1.05);
    expect(result.svgList[0].children.length).toBe(4); // 3 parts + 1 bin rect
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
    
    const workerUrl = path.resolve(__dirname, '../dist/worker.js');
    nest.config({ populationSize: 2, rotations: 1, workerUrl });

    const result = await new Promise((resolve) => {
        nest.start(() => {}, (svgList, efficiency, placedParts, totalParts) => {
            if (svgList) {
                nest.stop();
                resolve({ svgList, placedParts, totalParts, efficiency });
            }
        });
    });

    writeOutput('multiple_bins', result.svgList);

    expect(result.svgList.length).toBe(2);
    expect(result.placedParts).toBe(2);
    expect(result.efficiency).toBeGreaterThan(0.694 * 0.95);
    expect(result.efficiency).toBeLessThan(0.694 * 1.05);
    expect(result.svgList[0].children.length).toBe(2); // 1 part + 1 bin rect
    expect(result.svgList[1].children.length).toBe(2); // 1 part + 1 bin rect
  });

  it('should handle path elements (paths.svg)', async () => {
    let svg = readSvg('paths.svg');
    svg = svg.replace('</svg>', '<rect id="bin" x="0" y="0" width="500" height="500" fill="none" stroke="black" /></svg>');
    
    const nest = new SvgNest();
    const root = nest.parseSvg(svg);
    nest.setBin(root.querySelector('#bin'));
    
    const workerUrl = path.resolve(__dirname, '../dist/worker.js');
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
                resolve({ svgList, placedParts, totalParts, efficiency });
            }
        });
    });

    writeOutput('paths', result.svgList);

    expect(result.placedParts).toBe(6);
    expect(result.totalParts).toBe(6);
    expect(result.efficiency).toBeGreaterThan(0.062 * 0.95);
    expect(result.efficiency).toBeLessThan(0.062 * 1.05);
    expect(result.svgList[0].children.length).toBe(7); // 6 parts + 1 bin rect
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