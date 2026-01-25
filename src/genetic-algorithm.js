import GeometryUtil from './util/geometry.js';

class GeneticAlgorithm {
  constructor(adam, bin, config) {
    this.config = config || { populationSize: 10, mutationRate: 10, rotations: 4 };
    this.binBounds = GeometryUtil.getPolygonBounds(bin);
    this.binPolygon = bin; // Added: need bin polygon for checking if parts fit

    // population is an array of individuals. Each individual is a object representing the order of insertion and the angle each part is rotated
    const angles = [];
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
  randomAngle(part) {
    let angleList = [];
    for (let i = 0; i < Math.max(this.config.rotations, 1); i++) {
      angleList.push(i * (360 / this.config.rotations));
    }

    function shuffleArray(array) {
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

      // don't use obviously bad angles where the part doesn't fit in the bin
      if (rotatedPart.width < this.binBounds.width && rotatedPart.height < this.binBounds.height) {
        return angleList[i];
      }
    }

    return 0;
  }

  // returns a mutated individual with the given mutation rate
  mutate(individual) {
    const clone = { placement: individual.placement.slice(0), rotation: individual.rotation.slice(0) };
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
  mate(male, female) {
    const cutpoint = Math.round(Math.min(Math.max(Math.random(), 0.1), 0.9) * (male.placement.length - 1));

    const gene1 = male.placement.slice(0, cutpoint);
    const rot1 = male.rotation.slice(0, cutpoint);

    const gene2 = female.placement.slice(0, cutpoint);
    const rot2 = female.rotation.slice(0, cutpoint);

    for (let i = 0; i < female.placement.length; i++) {
      if (!this.contains(gene1, female.placement[i].id)) {
        gene1.push(female.placement[i]);
        rot1.push(female.rotation[i]);
      }
    }

    for (let i = 0; i < male.placement.length; i++) {
      if (!this.contains(gene2, male.placement[i].id)) {
        gene2.push(male.placement[i]);
        rot2.push(male.rotation[i]);
      }
    }

    return [{ placement: gene1, rotation: rot1 }, { placement: gene2, rotation: rot2 }];
  }
  
  contains(gene, id) {
    for (let i = 0; i < gene.length; i++) {
      if (gene[i].id == id) {
        return true;
      }
    }
    return false;
  }

  generation() {
    // Individuals with higher fitness are more likely to be selected for mating
    this.population.sort(function (a, b) {
      return a.fitness - b.fitness;
    });

    // fittest individual is preserved in the new generation (elitism)
    const newpopulation = [this.population[0]];

    while (newpopulation.length < this.population.length) {
      const male = this.randomWeightedIndividual();
      const female = this.randomWeightedIndividual(male);

      // each mating produces two children
      const children = this.mate(male, female);

      // slightly mutate children
      newpopulation.push(this.mutate(children[0]));

      if (newpopulation.length < this.population.length) {
        newpopulation.push(this.mutate(children[1]));
      }
    }

    this.population = newpopulation;
  }

  // returns a random individual from the population, weighted to the front of the list (lower fitness value is more likely to be selected)
  randomWeightedIndividual(exclude) {
    const pop = this.population.slice(0);

    if (exclude && pop.indexOf(exclude) >= 0) {
      pop.splice(pop.indexOf(exclude), 1);
    }

    const rand = Math.random();

    let lower = 0;
    const weight = 1 / pop.length;
    let upper = weight;

    for (let i = 0; i < pop.length; i++) {
      // if the random number falls between lower and upper bounds, select this individual
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