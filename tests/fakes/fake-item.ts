import { ItemDataPF2e } from '@item/data-definitions';

export class FakeItem {
    _data: Partial<ItemDataPF2e>;
    constructor(data: Partial<ItemDataPF2e>) {
        this._data = duplicate(data);
    }

    get data() {
        return this._data;
    }

    get name() {
        return this._data.name;
    }

    update(changes: object) {
        for (const [k, v] of Object.entries(changes)) {
            global.setProperty(this._data, k, v);
        }
    }
}
