import Component from '@ember/component';

import Map from 'esri/map';
import Graphic from 'esri/graphic';

const EsriMapComponent = Component.extend({
    didInsertElement() {
        this._mapInstance = new Map('map-container', { });
    }
});
export default EsriMapComponent;
