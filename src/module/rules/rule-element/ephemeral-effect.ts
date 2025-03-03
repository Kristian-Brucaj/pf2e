import { DeferredValueParams } from "@actor/modifiers";
import { ItemPF2e } from "@item";
import { ConditionSource, EffectSource } from "@item/data";
import { UUIDUtils } from "@util/uuid-utils";
import { ArrayField, BooleanField, ModelPropsFromSchema, StringField } from "types/foundry/common/data/fields.mjs";
import { RuleElementPF2e, RuleElementSchema } from "./";
import { ItemAlterationField, applyAlterations } from "./alter-item";

const { fields } = foundry.data;

/** An effect that applies ephemerally during a single action, such as a strike */
class EphemeralEffectRuleElement extends RuleElementPF2e<EphemeralEffectSchema> {
    static override defineSchema(): EphemeralEffectSchema {
        return {
            ...super.defineSchema(),
            affects: new fields.StringField({ required: true, choices: ["target", "origin"], initial: "target" }),
            selectors: new fields.ArrayField(
                new fields.StringField({ required: true, blank: false, nullable: false, initial: undefined })
            ),
            uuid: new fields.StringField({ required: true, blank: false, nullable: false, initial: undefined }),
            adjustName: new fields.BooleanField({ required: true, nullable: false, initial: true }),
            alterations: new fields.ArrayField(new ItemAlterationField(), {
                required: false,
                nullable: false,
                initial: [],
            }),
        };
    }

    protected override _validateModel(data: SourceFromSchema<EphemeralEffectSchema>): void {
        super._validateModel(data);

        if (data.selectors.length === 0) {
            throw Error("must have at least one selector");
        }
    }

    override afterPrepareData(): void {
        for (const selector of this.resolveInjectedProperties(this.selectors)) {
            const deferredEffect = this.#createDeferredEffect();
            const synthetics = (this.actor.synthetics.ephemeralEffects[selector] ??= { target: [], origin: [] });
            synthetics[this.affects].push(deferredEffect);
        }
    }

    #createDeferredEffect(): (params?: DeferredValueParams) => Promise<EffectSource | ConditionSource | null> {
        return async (params: DeferredValueParams = {}): Promise<EffectSource | ConditionSource | null> => {
            if (!this.test(params.test ?? this.actor.getRollOptions())) {
                return null;
            }

            const uuid = this.resolveInjectedProperties(this.uuid);
            if (!UUIDUtils.isItemUUID(uuid)) {
                this.failValidation(`"${uuid}" does not look like a UUID`);
                return null;
            }
            const effect = game.pf2e.ConditionManager.conditions.get(uuid) ?? (await fromUuid(uuid));
            if (!(effect instanceof ItemPF2e && effect.isOfType("condition", "effect"))) {
                this.failValidation(`unable to find effect or condition item with uuid "${uuid}"`);
                return null;
            }

            const source = effect.toObject();

            // An ephemeral effect will be added to a contextual clone's item source array and cannot include any
            // asynchronous rule elements
            const hasForbiddenREs = source.system.rules.some(
                (r) => typeof r.key === "string" && ["ChoiceSet", "GrantItem"].includes(r.key)
            );
            if (hasForbiddenREs) {
                this.failValidation("an ephemeral effect may not include a choice set or grant");
            }

            if (this.adjustName) {
                const label = this.data.label.includes(":")
                    ? this.label.replace(/^[^:]+:\s*|\s*\([^)]+\)$/g, "")
                    : this.label;
                source.name = `${source.name} (${label})`;
            }

            try {
                applyAlterations(source, this.alterations);
            } catch (error) {
                if (error instanceof Error) this.failValidation(error.message);
                return null;
            }

            return source;
        };
    }
}

interface EphemeralEffectRuleElement
    extends RuleElementPF2e<EphemeralEffectSchema>,
        ModelPropsFromSchema<EphemeralEffectSchema> {}

type EphemeralEffectSchema = RuleElementSchema & {
    affects: StringField<"target" | "origin", "target" | "origin", true, false, true>;
    selectors: ArrayField<StringField<string, string, true, false, false>>;
    uuid: StringField<string, string, true, false, false>;
    adjustName: BooleanField<boolean, boolean, true, false, true>;
    alterations: ArrayField<ItemAlterationField>;
};

export { EphemeralEffectRuleElement };
