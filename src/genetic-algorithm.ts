import GeometryUtil from './util/geometry.js';
import { Polygon } from './types.js';

export interface Individual {
  placement: Polygon[];
  rotation: number[];
  fitness?: number;
}

class GeneticAlgorithm {
  private config: { populationSize: number; mutationRate: number; rotations: number };
  private binBounds: { x: number; y: number; width: number; height: number } | null;
  public population: Individual[];

  constructor(adam: Polygon[], bin: Polygon, config?: { populationSize: number; mutationRate: number; rotations: number }) {
    this.config = config || { populationSize: 10, mutationRate: 10, rotations: 4 };
    this.binBounds = GeometryUtil.getPolygonBounds(bin);

    const angles: number[] = [];
    for (let i = 0; i < adam.length; i++) {
      angles.push(this.randomAngle(adam[i]));
    }

    this.population = [{ placement: adam, rotation: angles }];

    while (this.population.length < this.config.populationSize) {
      const mutant = this.mutate(this.population[0]);
      this.population.push(mutant);
    }
  }

  // returns a random angle of insertion
  randomAngle(part: Polygon): number {
    let angleList: number[] = [];
    for (let i = 0; i < Math.max(this.config.rotations, 1); i++) {
      angleList.push(i * (360 / this.config.rotations));
    }

    function shuffleArray(array: number[]) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = array[i];
        array[i] = array[j];
        array[j] = temp;
      }
      return array;
    }

    angleList = shuffleArray(angleList);

    for (let i = 0; i < angleList.length; i++) {
      const rotatedPart = GeometryUtil.rotatePolygon(part, angleList[i]);

      if (this.binBounds && rotatedPart.width! < this.binBounds.width && rotatedPart.height! < this.binBounds.height) {
        return angleList[i];
      }
    }

    return 0;
  }

  // returns a mutated individual with the given mutation rate
  mutate(individual: Individual): Individual {
    const clone: Individual = { placement: individual.placement.slice(0), rotation: individual.rotation.slice(0) };
    for (let i = 0; i < clone.placement.length; i++) {
      let rand = Math.random();
      if (rand < 0.01 * this.config.mutationRate) {
        // swap current part with next part
        const j = i + 1;

        if (j < clone.placement.length) {
          const temp = clone.placement[i];
          clone.placement[i] = clone.placement[j];
          clone.placement[j] = temp;
        }
      }

      rand = Math.random();
      if (rand < 0.01 * this.config.mutationRate) {
        clone.rotation[i] = this.randomAngle(clone.placement[i]);
      }
    }

    return clone;
  }

  // single point crossover
  mate(male: Individual, female: Individual): [Individual, Individual] {
    const cutpoint = Math.round(Math.min(Math.max(Math.random(), 0.1), 0.9) * (male.placement.length - 1));

    const gene1 = male.placement.slice(0, cutpoint);
    const rot1 = male.rotation.slice(0, cutpoint);

    const gene2 = female.placement.slice(0, cutpoint);
    const rot2 = female.rotation.slice(0, cutpoint);

    for (let i = 0; i < female.placement.length; i++) {
      if (!this.contains(gene1, female.placement[i].id!)) {
        gene1.push(female.placement[i]);
        rot1.push(female.rotation[i]);
      }
    }

    for (let i = 0; i < male.placement.length; i++) {
      if (!this.contains(gene2, male.placement[i].id!)) {
        gene2.push(male.placement[i]);
        rot2.push(male.rotation[i]);
      }
    }

    return [{ placement: gene1, rotation: rot1 }, { placement: gene2, rotation: rot2 }];
  }
  
  contains(gene: Polygon[], id: number): boolean {
    for (let i = 0; i < gene.length; i++) {
      if (gene[i].id === id) {
        return true;
      }
    }
    return false;
  }

  generation(): void {
    // Individuals with higher fitness are more likely to be selected for mating
    this.population.sort((a, b) => {
      return (a.fitness || 0) - (b.fitness || 0);
    });

    // fittest individual is preserved in the new generation (elitism)
    const newpopulation: Individual[] = [this.population[0]];

    while (newpopulation.length < this.population.length) {
      const male = this.randomWeightedIndividual();
      const female = this.randomWeightedIndividual(male);

      const children = this.mate(male, female);

      newpopulation.push(this.mutate(children[0]));

      if (newpopulation.length < this.population.length) {
        newpopulation.push(this.mutate(children[1]));
      }
    }

    this.population = newpopulation;
  }

  // returns a random individual from the population, weighted to the front of the list
  randomWeightedIndividual(exclude?: Individual): Individual {
    const pop = this.population.slice(0);

    if (exclude && pop.indexOf(exclude) >= 0) {
      pop.splice(pop.indexOf(exclude), 1);
    }

    const rand = Math.random();

    let lower = 0;
    const weight = 1 / pop.length;
    let upper = weight;

    for (let i = 0; i < pop.length; i++) {
      if (rand > lower && rand < upper) {
        return pop[i];
      }
      lower = upper;
      upper += 2 * weight * ((pop.length - i) / pop.length);
    }

    return pop[0];
  }
}

export default GeneticAlgorithm;
