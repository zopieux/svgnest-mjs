# SVGNest

A modern ES module for irregular shape nesting using a genetic algorithm. Based on the original [SVGNest by Jack000](https://github.com/Jack000/SVGnest).

```shell
$ yarn add svgnest-mjs
```

## Usage

```javascript
import SvgNest from 'svgnest-mjs';

const nest = new SvgNest();

// 1. Load your SVG
const root = nest.parseSvg(svgString);

// 2. Select the container (bin) element
const bin = root.querySelector('#bin');
nest.setBin(bin);

// 3. Configure (optional)
nest.config({
  spacing: 10,
  rotations: 4,
  populationSize: 10
});

// 4. Start nesting
nest.start(
  (progress) => console.log(`NFP Progress: ${progress * 100}%`),
  (svgList, efficiency, placedCount, totalCount) => {
    if (svgList) {
      console.log(`Placed ${placedCount}/${totalCount} at ${efficiency * 100}% efficiency`);
      document.body.appendChild(svgList[0]);
    }
  }
);

// 5. Stop when satisfied
// nest.stop();
```

## License
MIT
