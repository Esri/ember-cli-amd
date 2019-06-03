import Component from '@ember/component';

import Map from 'esri/map';

const EsriMapComponent = Component.extend({
    didInsertElement() {
        this._mapInstance = new Map('map-container', { });
    }
});
export default EsriMapComponent;
