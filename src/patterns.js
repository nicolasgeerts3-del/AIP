// Patrons proposés à l'étape 3 (« Modèle à découper »).
//
// Contours en cm, relevés dans les patrons PDF (marges de couture comprises
// quand le patron les inclut) :
//  - pièces « au pli » : dépliées, puisque le tissu est découpé à plat, en une épaisseur ;
//  - pièces tournées pour avoir le droit-fil vertical, comme les pièces du T-shirt ;
//  - quantités : tissu extérieur + doublure (le molleton et le thermocollant ne sont pas comptés).
// Sac banane et monstre : patrons scannés, contour tracé sur l'image (précision ≈ 0,5 mm).
import { COLORS, KIT, PIECES } from './config.js';

export const MODELS = Object.freeze({
  't-shirt': {
    label: 'T-shirt', one: 'T-shirt', many: 'T-shirts',
    pieces: PIECES, kit: KIT, colors: COLORS,
    sizeHint: 'un T-shirt demande environ 1,1 m × 0,8 m'
  },
  'portefeuille': {
    label: 'Portefeuille Sympatoche', one: 'portefeuille', many: 'portefeuilles', source: 'PorteFeuillle-Sympatoche.pdf',
    pieces: {
      'PRINCIPALE': [[0,1.77],[0.06,1.31],[0.24,0.89],[0.52,0.52],[0.88,0.24],[1.31,0.06],[1.77,0],[14.23,0],[14.69,0.06],[15.12,0.24],[15.48,0.52],[15.76,0.88],[15.94,1.31],[16,1.77],[16,22],[0,22]], // au pli, dépliée ; tissu extérieur + doublure
      'PORTE-BILLETS': [[0,0],[16,0],[16,20],[0,20]], // au pli, dépliée ; droit-fil horizontal sur le patron
      'PORTE-CARTES': [[0,0],[16,0],[16,16],[0,16]], // au pli, dépliée
      'POCHE': [[0,0],[16,0],[16,11],[0,11]], // droit-fil horizontal sur le patron
      'LANGUETTE': [[0,0],[5,0],[5,10],[0,10]],
    },
    kit: { 'PRINCIPALE': 2, 'PORTE-BILLETS': 2, 'PORTE-CARTES': 2, 'POCHE': 2, 'LANGUETTE': 1 },
    colors: { 'PRINCIPALE': '#3979b5', 'PORTE-BILLETS': '#4f9b69', 'PORTE-CARTES': '#e58b3e', 'POCHE': '#8d6bb3', 'LANGUETTE': '#c2577a' }
  },
  'porte-monnaie': {
    label: 'Porte-monnaie origami', one: 'porte-monnaie', many: 'porte-monnaie', source: 'Porte-Monnaie-Origami.pdf',
    pieces: {
      'PORTE-MONNAIE': [[0,0],[9.02,5.33],[9,24.79],[0,19.47]], // parallélogramme, droit-fil le long du grand côté
    },
    kit: { 'PORTE-MONNAIE': 2 },
    colors: { 'PORTE-MONNAIE': '#3979b5' }
  },
  'porte-gourde': {
    label: 'Porte-gourde', one: 'porte-gourde', many: 'porte-gourdes', source: 'Porte-Gourde.pdf',
    pieces: {
      'CORPS': [[0,0],[16,0],[16,26],[0,26]], // tissu extérieur + doublure
      'FERMETURE': [[0,0],[16,0],[16,11],[0,11]], // doublure ; droit-fil horizontal sur le patron
      'BASE': [[10,5],[9.96,5.65],[9.83,6.29],[9.62,6.91],[9.33,7.5],[8.97,8.04],[8.54,8.54],[8.04,8.97],[7.5,9.33],[6.91,9.62],[6.29,9.83],[5.65,9.96],[5,10],[4.35,9.96],[3.71,9.83],[3.09,9.62],[2.5,9.33],[1.96,8.97],[1.46,8.54],[1.03,8.04],[0.67,7.5],[0.38,6.91],[0.17,6.29],[0.04,5.65],[0,5],[0.04,4.35],[0.17,3.71],[0.38,3.09],[0.67,2.5],[1.03,1.96],[1.46,1.46],[1.96,1.03],[2.5,0.67],[3.09,0.38],[3.71,0.17],[4.35,0.04],[5,0],[5.65,0.04],[6.29,0.17],[6.91,0.38],[7.5,0.67],[8.04,1.03],[8.54,1.46],[8.97,1.96],[9.33,2.5],[9.62,3.09],[9.83,3.71],[9.96,4.35]], // disque de 10 cm ; tissu extérieur + doublure
      'ATTACHE': [[0,0],[5,0],[5,16],[0,16]],
    },
    kit: { 'CORPS': 4, 'FERMETURE': 2, 'BASE': 2, 'ATTACHE': 2 },
    colors: { 'CORPS': '#3979b5', 'FERMETURE': '#4f9b69', 'BASE': '#e58b3e', 'ATTACHE': '#8d6bb3' }
  },
  'monstre': {
    label: 'Monstre en feutrine', one: 'monstre', many: 'monstres', source: 'Felt-Monster-Pattern-1.pdf',
    pieces: {
      'CORPS': [[8.13,0.03],[8,0],[7.85,0.1],[7.62,0.86],[7.32,1.37],[6.81,1.8],[6.45,1.93],[6.2,1.93],[5.79,1.73],[5.11,1.07],[4.47,0.25],[4.27,0.18],[4.09,0.23],[3.94,0.38],[3.12,1.65],[2.41,2.97],[2.11,3.89],[1.8,5.54],[1.7,5.59],[1.57,5.51],[0.91,4.5],[0.69,4.32],[0.36,4.39],[0.23,4.5],[0.1,4.78],[0,5.41],[0.03,5.99],[0.28,6.88],[0.86,7.85],[1.27,8.28],[1.68,8.56],[1.96,10.13],[2.26,11.4],[2.51,12.19],[2.84,12.9],[3.43,13.77],[3.73,14.07],[4.09,14.27],[4.34,14.3],[4.62,14.22],[4.8,14.12],[5.08,13.82],[5.28,13.26],[5.36,12.04],[5.49,11.94],[5.97,11.99],[7.24,11.94],[7.59,13.13],[8,13.89],[8.31,14.17],[8.59,14.27],[8.86,14.25],[9.3,14.05],[9.8,13.44],[10.16,12.52],[10.69,8.61],[11.33,8.08],[11.73,7.62],[12.09,7.09],[12.4,6.4],[12.47,6.02],[12.45,5.54],[12.27,5.16],[12.04,4.95],[11.81,4.85],[11.56,4.85],[11.35,4.98],[10.95,5.44],[10.77,5.41],[10.52,4.04],[10.11,2.72],[9.8,2.11],[9.19,1.17],[8.56,0.38]],
      'BOUCHE': [[0.05,0],[0,1.02],[0.2,1.83],[0.43,2.24],[0.79,2.62],[1.45,3],[2.03,3.15],[2.67,3.15],[3.38,2.95],[4.06,2.51],[4.67,1.7],[4.62,1.63],[3.89,1.7],[3.07,1.68],[2.36,1.52],[1.98,1.35],[1.37,0.94],[0.18,0]],
      'DENT': [[0,0.03],[0.53,0.79],[0.66,0.89],[0.71,0.86],[0.99,0.05],[0.71,0]],
    },
    kit: { 'CORPS': 2, 'BOUCHE': 1, 'DENT': 2 },
    colors: { 'CORPS': '#3979b5', 'BOUCHE': '#4f9b69', 'DENT': '#e58b3e' }
  },
  'sac-banane': {
    label: 'Sac banane Fransi', one: 'sac banane', many: 'sacs banane', source: 'Sac-Banane-Fransi-Snaply-Magazine.pdf',
    pieces: {
      'DOS': [[0,0.08],[0,4.95],[3.05,6.93],[3.89,7.62],[4.72,8.46],[5.46,9.37],[6.07,10.29],[8.03,13.79],[8.48,14.4],[9.17,15.09],[10.08,15.7],[11.13,16.15],[12.52,16.56],[14.1,16.84],[15.27,16.97],[17.6,17.04],[17.7,17.09],[20.83,16.92],[22.28,16.71],[23.44,16.46],[24.43,16.15],[25.48,15.7],[26.06,15.34],[26.59,14.91],[27.41,13.97],[28.12,12.83],[29.49,10.29],[30.1,9.37],[30.84,8.46],[31.67,7.62],[32.51,6.93],[35.56,4.95],[35.56,0.08],[17.96,0.05],[17.7,0],[17.6,0.05]], // au pli, dépliée ; tissu extérieur + doublure
      'AVANT': [[0,0.08],[0,5.89],[1.12,6.6],[2.39,7.62],[5.64,10.82],[7.01,11.94],[7.59,12.32],[8.46,12.75],[9.55,13.13],[10.69,13.41],[11.73,13.59],[13.54,13.77],[15.37,13.79],[15.47,13.84],[15.72,13.79],[17.07,13.79],[18.75,13.67],[20.75,13.34],[22.17,12.93],[23.49,12.32],[24.66,11.51],[25.45,10.82],[28.7,7.62],[29.97,6.6],[31.09,5.89],[31.09,0.08],[15.72,0.05],[15.47,0],[15.37,0.05]], // au pli, dépliée ; tissu extérieur + doublure
      'RABAT': [[28.96,6.73],[28.6,6.3],[27.43,5.21],[25.07,3.38],[23.06,2.13],[21.29,1.27],[19.46,0.61],[17.32,0.13],[16.13,0],[14.5,0],[14.48,0.05],[14.45,0],[12.83,0],[11.18,0.2],[9.5,0.61],[7.67,1.27],[6.27,1.93],[4.57,2.92],[2.95,4.06],[1.09,5.59],[0.36,6.3],[0,6.76],[1.45,8.79],[3.58,8.48],[6.17,8.23],[8.53,8.08],[11.58,7.98],[14.33,7.98],[14.4,8.05],[14.48,8],[14.55,8.05],[14.63,7.98],[17.37,7.98],[20.93,8.1],[24.23,8.36],[27.51,8.79]], // au pli, dépliée ; droit-fil horizontal sur le patron
      'CÔTÉ': [[0,0],[0,4.88],[5.38,8.79],[5.49,8.79],[5.49,0]], // tissu extérieur + doublure
    },
    kit: { 'DOS': 4, 'AVANT': 2, 'RABAT': 2, 'CÔTÉ': 4 },
    colors: { 'DOS': '#3979b5', 'AVANT': '#4f9b69', 'RABAT': '#e58b3e', 'CÔTÉ': '#8d6bb3' }
  }
});

export const DEFAULT_MODEL = 't-shirt';
