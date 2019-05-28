import { module, test } from 'qunit';
import { setupApplicationTest } from 'ember-qunit';
import { visit } from '@ember/test-helpers';

module('setup test', async function(hooks) {
    setupApplicationTest(hooks);

    test('it works', async function(assert) {
        assert.expect(1);

        await visit('/');

        assert.ok(true, 'We got here');
    });
});