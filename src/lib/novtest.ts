import { emptyFiltered, syncFiltered } from './collection';
import { compileSearch } from './search';
import { STARTER_PRESET_ID, loadStarterDecks, starterGuids, type StarterDeck, type StarterNote } from './starter';
import { DEFAULT_PRESET } from './seed';
import { all, get, put, remove } from './store';
import type { Deck, Note } from './types';

/*
 * The Year 9–10 Biology test in November: exactly the statements on the school's checklist
 * (Edexcel IGCSE 4BI1 – everything except stem cells, the nervous system, eye and plant
 * responses, inheritance, and selective breeding / genetic modification / cloning).
 * Cards in scope are tagged and gathered into a "November test" filtered deck while the
 * sprint lasts; afterwards they go back home to the Biology deck.
 */

export const NOV_TAG = 'november_test';
export const NOV_DECK_ID = 'd-test-november';
export const NOV_DECK_NAME = 'November test – Biology';

/** [spec point, deck topic, statement] in specification order. */
export const CHECKLIST: [string, string, string][] = [
  ['1.1', '1 Variety of living organisms', "understand how living organisms share the following characteristics: they require nutrition; they respire; they excrete their waste; they respond to their surroundings; they move; they control their internal conditions; they reproduce; they grow and develop"],
  ['1.2', '1 Variety of living organisms', "describe the common features shown by eukaryotic organisms: plants, animals, fungi and protoctists"],
  ['1.3', '1 Variety of living organisms', "describe the common features shown by prokaryotic organisms such as bacteria"],
  ['1.4', '1 Variety of living organisms', "understand the term pathogen and know that pathogens may include fungi, bacteria, protoctists or viruses"],
  ['2.1', '2a–b Cells and organisation', "describe the levels of organisation in organisms: organelles, cells, tissues, organs and systems"],
  ['2.2', '2a–b Cells and organisation', "describe cell structures, including the nucleus, cytoplasm, cell membrane, cell wall, mitochondria, chloroplasts, ribosomes and vacuole"],
  ['2.3', '2a–b Cells and organisation', "describe the functions of the nucleus, cytoplasm, cell membrane, cell wall, mitochondria, chloroplasts, ribosomes and vacuole"],
  ['2.4', '2a–b Cells and organisation', "know the similarities and differences in the structure of plant and animal cells"],
  ['2.7', '2c Biological molecules', "identify the chemical elements present in carbohydrates, proteins and lipids (fats and oils)"],
  ['2.8', '2c Biological molecules', "describe the structure of carbohydrates, proteins and lipids as large molecules made up from smaller basic units: starch and glycogen from simple sugars, protein from amino acids, and lipid from fatty acids and glycerol"],
  ['2.9', '2c Biological molecules', "practical: investigate food samples for the presence of glucose, starch, protein and fat"],
  ['2.10', '2c Biological molecules', "understand the role of enzymes as biological catalysts in metabolic reactions"],
  ['2.11', '2c Biological molecules', "understand how temperature changes can affect enzyme function, including changes to the shape of active site"],
  ['2.12', '2c Biological molecules', "practical: investigate how enzyme activity can be affected by changes in temperature"],
  ['2.13', '2c Biological molecules', "understand how enzyme function can be affected by changes in pH altering the active site"],
  ['2.14B', '2c Biological molecules', "practical: investigate how enzyme activity can be affected by changes in pH"],
  ['2.15', '2d Movement of substances', "understand the processes of diffusion, osmosis and active transport by which substances move into and out of cells"],
  ['2.16', '2d Movement of substances', "understand how factors affect the rate of movement of substances into and out of cells, including the effects of surface area to volume ratio, distance, temperature and concentration gradient"],
  ['2.17', '2d Movement of substances', "practical: investigate diffusion and osmosis using living and non-living systems"],
  ['2.18', '2e Plant nutrition', "understand the process of photosynthesis and its importance in the conversion of light energy to chemical energy"],
  ['2.19', '2e Plant nutrition', "know the word equation and the balanced chemical symbol equation for photosynthesis"],
  ['2.20', '2e Plant nutrition', "understand how varying carbon dioxide concentration, light intensity and temperature affect the rate of photosynthesis"],
  ['2.21', '2e Plant nutrition', "describe the structure of the leaf and explain how it is adapted for photosynthesis"],
  ['2.22', '2e Plant nutrition', "understand that plants require mineral ions for growth, and that magnesium ions are needed for chlorophyll and nitrate ions are needed for amino acids"],
  ['2.23', '2e Plant nutrition', "practical: investigate photosynthesis, showing the evolution of oxygen from a water plant, the production of starch and the requirements of light, carbon dioxide and chlorophyll"],
  ['2.24', '2e Human nutrition', "understand that a balanced diet should include appropriate proportions of carbohydrate, protein, lipid, vitamins, minerals, water and dietary fibre"],
  ['2.25', '2e Human nutrition', "identify the sources and describe the functions of carbohydrate, protein, lipid (fats and oils), vitamins A, C and D, the mineral ions calcium and iron, water and dietary fibre as components of the diet"],
  ['2.26', '2e Human nutrition', "understand how energy requirements vary with activity levels, age and pregnancy"],
  ['2.27', '2e Human nutrition', "describe the structure and function of the human alimentary canal, including the mouth, oesophagus, stomach, small intestine (duodenum and ileum), large intestine (colon and rectum) and pancreas"],
  ['2.28', '2e Human nutrition', "understand how food is moved through the gut by peristalsis"],
  ['2.29', '2e Human nutrition', "understand the role of digestive enzymes, including the digestion of starch to glucose by amylase and maltase, the digestion of proteins to amino acids by proteases and the digestion of lipids to fatty acids and glycerol by lipases"],
  ['2.30', '2e Human nutrition', "understand that bile is produced by the liver and stored in the gall bladder"],
  ['2.31', '2e Human nutrition', "understand the role of bile in neutralising stomach acid and emulsifying lipids"],
  ['2.32', '2e Human nutrition', "understand how the small intestine is adapted for absorption, including the structure of a villus"],
  ['2.33B', '2e Human nutrition', "practical: investigate the energy content in a food sample"],
  ['2.34', '2f Respiration', "understand how the process of respiration produces ATP in living organisms"],
  ['2.35', '2f Respiration', "know that ATP provides energy for cells"],
  ['2.36', '2f Respiration', "describe the differences between aerobic and anaerobic respiration"],
  ['2.37', '2f Respiration', "know the word equation and the balanced chemical symbol equation for aerobic respiration in living organisms"],
  ['2.38', '2f Respiration', "know the word equation for anaerobic respiration in plants and in animals"],
  ['2.39', '2f Respiration', "practical: investigate the evolution of carbon dioxide and heat from respiring seeds or other suitable living organisms"],
  ['2.40B', '2g Gas exchange', "understand the role of diffusion in gas exchange"],
  ['2.41B', '2g Gas exchange', "understand gas exchange (of carbon dioxide and oxygen) in relation to respiration and photosynthesis"],
  ['2.42B', '2g Gas exchange', "understand how the structure of the leaf is adapted for gas exchange"],
  ['2.43B', '2g Gas exchange', "describe the role of stomata in gas exchange"],
  ['2.44B', '2g Gas exchange', "understand how respiration continues during the day and night, but that the net exchange of carbon dioxide and oxygen depends on the intensity of light"],
  ['2.45B', '2g Gas exchange', "practical: investigate the effect of light on net gas exchange from a leaf, using hydrogen-carbonate indicator"],
  ['2.46', '2g Gas exchange', "describe the structure of the thorax, including the ribs, intercostal muscles, diaphragm, trachea, bronchi, bronchioles, alveoli and pleural membranes"],
  ['2.47', '2g Gas exchange', "understand the role of the intercostal muscles and the diaphragm in ventilation"],
  ['2.48', '2g Gas exchange', "explain how alveoli are adapted for gas exchange by diffusion between air in the lungs and blood in capillaries"],
  ['2.49', '2g Gas exchange', "understand the biological consequences of smoking in relation to the lungs and the circulatory system, including coronary heart disease"],
  ['2.50', '2g Gas exchange', "practical: investigate breathing in humans, including the release of carbon dioxide and the effect of exercise"],
  ['2.51', '2h Transport', "understand why simple, unicellular organisms can rely on diffusion for movement of substances in and out of the cell"],
  ['2.52', '2h Transport', "understand the need for a transport system in multicellular organisms"],
  ['2.53', '2h Transport', "describe the role of phloem in transporting sucrose and amino acids between the leaves and other parts of the plant"],
  ['2.54', '2h Transport', "describe the role of xylem in transporting water and mineral ions from the roots to other parts of the plant"],
  ['2.55B', '2h Transport', "understand how water is absorbed by root hair cells"],
  ['2.56B', '2h Transport', "understand that transpiration is the evaporation of water from the surface of a plant"],
  ['2.57B', '2h Transport', "understand how the rate of transpiration is affected by changes in humidity, wind speed, temperature and light intensity"],
  ['2.58B', '2h Transport', "practical: investigate the role of environmental factors in determining the rate of transpiration from a leafy shoot"],
  ['2.59', '2h Transport', "describe the composition of the blood: red blood cells, white blood cells, platelets and plasma"],
  ['2.60', '2h Transport', "understand the role of plasma in the transport of carbon dioxide, digested food, urea, hormones and heat energy"],
  ['2.61', '2h Transport', "understand how adaptations of red blood cells make them suitable for the transport of oxygen, including shape, the absence of a nucleus and the presence of haemoglobin"],
  ['2.62', '2h Transport', "understand how the immune system responds to disease using white blood cells, illustrated by phagocytes ingesting pathogens and lymphocytes releasing antibodies specific to the pathogen"],
  ['2.63B', '2h Transport', "understand how vaccination results in the manufacture of memory cells, which enable future antibody production to the pathogen to occur sooner, faster and in greater quantity"],
  ['2.64B', '2h Transport', "understand how platelets are involved in blood clotting, which prevents blood loss and the entry of micro-organisms"],
  ['2.65', '2h Transport', "describe the structure of the heart and how it functions"],
  ['2.66', '2h Transport', "explain how the heart rate changes during exercise and under the influence of adrenaline"],
  ['2.67', '2h Transport', "understand how factors may increase the risk of developing coronary heart disease"],
  ['2.68', '2h Transport', "understand how the structure of arteries, veins and capillaries relate to their function"],
  ['2.69', '2h Transport', "understand the general structure of the circulation system, including the blood vessels to and from the heart and lungs, liver and kidneys"],
  ['2.70', '2i Excretion', "understand the origin of carbon dioxide and oxygen as waste products of metabolism and their loss from the stomata of a leaf"],
  ['2.71', '2i Excretion', "know the excretory products of the lungs, kidneys and skin (organs of excretion)"],
  ['2.72B', '2i Excretion', "understand how the kidney carries out its roles of excretion and osmoregulation"],
  ['2.73B', '2i Excretion', "describe the structure of the urinary system, including the kidneys, ureters, bladder and urethra"],
  ['2.74B', '2i Excretion', "describe the structure of a nephron, including the Bowman’s capsule and glomerulus, convoluted tubules, loop of Henle and collecting duct"],
  ['2.75B', '2i Excretion', "describe ultrafiltration in the Bowman’s capsule and the composition of the glomerular filtrate"],
  ['2.76B', '2i Excretion', "understand how water is reabsorbed into the blood from the collecting duct"],
  ['2.77B', '2i Excretion', "understand why selective reabsorption of glucose occurs at the proximal convoluted tubule"],
  ['2.78B', '2i Excretion', "describe the role of ADH in regulating the water content of the blood"],
  ['2.79B', '2i Excretion', "understand that urine contains water, urea and ions"],
  ['2.80', '2j Coordination and response', "understand how organisms are able to respond to changes in their environment"],
  ['2.81', '2j Coordination and response', "understand that homeostasis is the maintenance of a constant internal environment, and that body water content and body temperature are both examples of homeostasis"],
  ['2.82', '2j Coordination and response', "understand that a co-ordinated response requires a stimulus, a receptor and an effector"],
  ['2.93', '2j Coordination and response', "describe the role of the skin in temperature regulation, with reference to sweating, vasoconstriction and vasodilation"],
  ['2.94', '2j Coordination and response', "understand the sources, roles and effects of the following hormones: adrenaline, insulin, testosterone, progesterone and oestrogen"],
  ['2.95B', '2j Coordination and response', "understand the sources, roles and effects of the following hormones: ADH, FSH and LH"],
  ['3.1', '3a Reproduction', "understand the differences between sexual and asexual reproduction"],
  ['3.2', '3a Reproduction', "understand that fertilisation involves the fusion of a male and female gamete to produce a zygote that undergoes cell division and develops into an embryo"],
  ['3.3', '3a Reproduction', "describe the structures of an insect-pollinated and a wind-pollinated flower and explain how each is adapted for pollination"],
  ['3.4', '3a Reproduction', "understand that the growth of the pollen tube followed by fertilisation leads to seed and fruit formation"],
  ['3.5', '3a Reproduction', "practical: investigate the conditions needed for seed germination"],
  ['3.6', '3a Reproduction', "understand how germinating seeds utilise food reserves until the seedling can carry out photosynthesis"],
  ['3.7', '3a Reproduction', "understand that plants can reproduce asexually by natural methods (illustrated by runners) and by artificial methods (illustrated by cuttings)"],
  ['3.8', '3a Reproduction', "understand how the structure of the male and female reproductive systems are adapted for their functions"],
  ['3.9', '3a Reproduction', "understand the roles of oestrogen and progesterone in the menstrual cycle"],
  ['3.10B', '3a Reproduction', "understand the roles of FSH and LH in the menstrual cycle"],
  ['3.11', '3a Reproduction', "describe the role of the placenta in the nutrition of the developing embryo"],
  ['3.12', '3a Reproduction', "understand how the developing embryo is protected by amniotic fluid"],
  ['3.13', '3a Reproduction', "understand the roles of oestrogen and testosterone in the development of secondary sexual characteristics"],
  ['4.1', '4 Ecology and environment', "understand the terms population, community, habitat and ecosystem"],
  ['4.2', '4 Ecology and environment', "practical: investigate the population size of an organism in two different areas using quadrats"],
  ['4.3B', '4 Ecology and environment', "understand the term biodiversity"],
  ['4.4B', '4 Ecology and environment', "practical: investigate the distribution of organisms in their habitats and measure biodiversity using quadrats"],
  ['4.5', '4 Ecology and environment', "understand how abiotic and biotic factors affect the population size and distribution of organisms"],
  ['4.6', '4 Ecology and environment', "understand the names given to different trophic levels, including producers, primary, secondary and tertiary consumers and decomposers"],
  ['4.7', '4 Ecology and environment', "understand the concepts of food chains, food webs, pyramids of number, pyramids of biomass and pyramids of energy transfer"],
  ['4.8', '4 Ecology and environment', "understand the transfer of substances and energy along a food chain"],
  ['4.9', '4 Ecology and environment', "understand why only about 10% of energy is transferred from one trophic level to the next"],
  ['4.10', '4 Ecology and environment', "describe the stages in the carbon cycle, including respiration, photosynthesis, decomposition and combustion"],
  ['4.11B', '4 Ecology and environment', "describe the stages in the nitrogen cycle, including the roles of nitrogen fixing bacteria, decomposers, nitrifying bacteria and denitrifying bacteria (specific names of bacteria are not required)"],
  ['4.12', '4 Ecology and environment', "understand the biological consequences of pollution of air by sulfur dioxide and carbon monoxide"],
  ['4.13', '4 Ecology and environment', "understand that water vapour, carbon dioxide, nitrous oxide, methane and CFCs are greenhouse gases"],
  ['4.14', '4 Ecology and environment', "understand how human activities contribute to greenhouse gases"],
  ['4.15', '4 Ecology and environment', "understand how an increase in greenhouse gases results in an enhanced greenhouse effect and that this may lead to global warming and its consequences"],
  ['4.16', '4 Ecology and environment', "understand the biological consequences of pollution of water by sewage"],
  ['4.17', '4 Ecology and environment', "understand the biological consequences of eutrophication caused by leached minerals from fertiliser"],
  ['4.18B', '4 Ecology and environment', "understand the effects of deforestation, including leaching, soil erosion, disturbance of evapotranspiration and the carbon cycle, and the balance of atmospheric gases"],
  ['5.1', '5 Use of biological resources', "describe how glasshouses and polythene tunnels can be used to increase the yield of certain crops"],
  ['5.2', '5 Use of biological resources', "understand the effects on crop yield of increased carbon dioxide and increased temperature in glasshouses"],
  ['5.3', '5 Use of biological resources', "understand how the use of fertiliser can increase crop yield"],
  ['5.4', '5 Use of biological resources', "understand the reasons for pest control and the advantages and disadvantages of using pesticides and biological control with crop plants"],
  ['5.5', '5 Use of biological resources', "understand the role of yeast in the production of food including bread"],
  ['5.6', '5 Use of biological resources', "practical: investigate the role of anaerobic respiration by yeast in different conditions"],
  ['5.7', '5 Use of biological resources', "understand the role of bacteria (Lactobacillus) in the production of yoghurt"],
  ['5.8', '5 Use of biological resources', "understand the use of an industrial fermenter and explain the need to provide suitable conditions in the fermenter, including aseptic precautions, nutrients, optimum temperature and pH, oxygenation and agitation, for the growth of micro-organisms"],
  ['5.9B', '5 Use of biological resources', "understand the methods used to farm large numbers of fish to provide a source of protein, including maintaining water quality, controlling intraspecific and interspecific predation, controlling disease, removing waste products, controlling the quality and frequency of feeding, and selective breeding"],
];

/** What isn't on the test, for each topic that is only partly tested. */
export const NOT_ON_TEST: Record<string, string> = {
  '2a–b Cells and organisation': 'not stem cells or differentiation',
  '2j Coordination and response': 'not the nervous system, eye, plant responses, glucagon or diabetes',
  '3b Inheritance': 'not on the test',
  '5 Use of biological resources': 'not selective breeding, genetic modification or cloning',
};

const OFF_TOPICS = new Set(['3b Inheritance']);
const OFF_SUBS = new Set([
  'Plant responses', 'Nervous system – extra detail', 'Eye – extra detail',
  'Selective breeding – extra detail', 'Genetic modification – extra detail', 'Cloning – extra detail',
]);
const OFF_CARDS: Record<string, RegExp> = {
  '2a–b Cells and organisation': /stem cell|differentiat|meristem/i,
  '2j Coordination and response': /phototropism|geotropism|gravitropism|auxin|nervous|reflex|synapse|neurone|cornea|\beye\b|glucagon|diabetes|glucose concentration is raised|glycogen stored/i,
  '5 Use of biological resources': /selective breeding|restriction enzyme|ligase|vector|insulin is made|transgenic|GM crop|Dolly|clone/i,
};

/** Is this Biology starter card on the November test? */
export function onNovemberTest(n: Pick<StarterNote, 'topic' | 'sub' | 'front'>): boolean {
  if (OFF_TOPICS.has(n.topic) || OFF_SUBS.has(n.sub)) return false;
  return !OFF_CARDS[n.topic]?.test(n.front);
}

/** Topics with at least one statement on the test. */
export const testTopics = () => [...new Set(CHECKLIST.map((c) => c[1]))];

let running = false;

/**
 * Keeps the November test section up to date: tags the Biology cards that are on the test and
 * gathers them into the filtered deck, moving only cards that changed. After the last test day the
 * cards go home and the deck is removed. If the student deletes the deck it stays deleted.
 */
export async function syncNovemberSection(today: string, sprintEnd: string, decks?: StarterDeck[]): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const deck = get('deck', NOV_DECK_ID);
    if (today > sprintEnd) {
      if (deck && !deck.deleted) { emptyFiltered(NOV_DECK_ID); remove('deck', NOV_DECK_ID); }
      return 0;
    }
    if (deck?.deleted) return 0;
    const bio = (decks || (await loadStarterDecks())).find((d) => d.key === 'biology');
    if (!bio) return 0;
    const notes = all('note').filter((n) => n.guid?.startsWith('starter:biology:'));
    if (!notes.length) return 0;
    const inScope = starterGuids(bio, onNovemberTest);
    const changed: Note[] = [];
    for (const n of notes) {
      const want = inScope.has(n.guid!);
      if (want !== n.tags.includes(NOV_TAG)) changed.push({ ...n, tags: want ? [...n.tags, NOV_TAG] : n.tags.filter((t) => t !== NOV_TAG) });
    }
    if (changed.length) put(changed);
    if (!deck) {
      const d: Deck = {
        id: NOV_DECK_ID, kind: 'deck', updatedAt: 0, name: NOV_DECK_NAME, parentId: null,
        presetId: get('preset', STARTER_PRESET_ID) ? STARTER_PRESET_ID : DEFAULT_PRESET.id,
        description: 'Every Biology card on your Year 9–10 test checklist. Cards go back to the Biology deck after the test.',
        filtered: { search: `tag:${NOV_TAG}`, limit: 9999, order: 'added', reschedule: true }, createdAt: Date.now(),
      };
      put(d);
    }
    return syncFiltered(NOV_DECK_ID, compileSearch(`tag:${NOV_TAG}`));
  } finally {
    running = false;
  }
}
