import { SkillLongForm } from "@actor/types";
import { TokenDocumentPF2e } from "@scene";
import { ErrorPF2e } from "@util";
import { EncounterPF2e } from ".";
import { ActorPF2e } from "@actor";

class CombatantPF2e<
    TParent extends EncounterPF2e | null = EncounterPF2e | null,
    TTokenDocument extends TokenDocumentPF2e | null = TokenDocumentPF2e | null
> extends Combatant<TParent, TTokenDocument> {
    get encounter(): TParent {
        return this.parent;
    }

    /** The round this combatant last had a turn */
    get roundOfLastTurn(): number | null {
        return this.flags.pf2e.roundOfLastTurn;
    }

    /** Can the user see this combatant's name? */
    get playersCanSeeName(): boolean {
        return !!this.token?.playersCanSeeName;
    }

    overridePriority(initiative: number): number | null {
        return this.flags.pf2e.overridePriority[initiative] ?? null;
    }

    hasHigherInitiative(
        this: RolledCombatant<NonNullable<TParent>>,
        { than }: { than: RolledCombatant<NonNullable<TParent>> }
    ): boolean {
        if (this.parent.id !== than.parent.id) {
            throw ErrorPF2e("The initiative of Combatants from different combats cannot be compared");
        }

        return this.parent.getCombatantWithHigherInit(this, than) === this;
    }

    /** Get the active Combatant for the given actor, creating one if necessary */
    static async fromActor(actor: ActorPF2e, render = true): Promise<CombatantPF2e<EncounterPF2e> | null> {
        if (!game.combat) {
            ui.notifications.error(game.i18n.localize("PF2E.Encounter.NoActiveEncounter"));
            return null;
        }
        const token = actor.getActiveTokens().pop();
        const existing = game.combat.combatants.find((combatant) => combatant.actor === actor);
        if (existing) {
            return existing;
        } else if (token) {
            const combatants = await game.combat.createEmbeddedDocuments(
                "Combatant",
                [
                    {
                        tokenId: token.id,
                        actorId: token.actor?.id,
                        sceneId: token.scene.id,
                        hidden: token.document.hidden,
                    },
                ],
                { render }
            );
            return combatants.at(0) ?? null;
        }
        ui.notifications.error(game.i18n.format("PF2E.Encounter.NoTokenInScene", { actor: actor.name }));
        return null;
    }

    async startTurn(): Promise<void> {
        const { actor, encounter } = this;
        if (!encounter || !actor) return;

        const actorUpdates: Record<string, unknown> = {};

        // Run any turn start events before the effect tracker updates.
        // In PF2e rules, the order is interchangeable. We'll need to be more dynamic with this later.
        for (const rule of actor.rules) {
            await rule.onTurnStart?.(actorUpdates);
        }

        // Now that a user has been found, make the updates if there are any
        await this.update({ "flags.pf2e.roundOfLastTurn": encounter.round });
        if (Object.keys(actorUpdates).length > 0) {
            await actor.update(actorUpdates, { render: false });
        }

        Hooks.callAll("pf2e.startTurn", this, encounter, game.user.id);
    }

    async endTurn(options: { round: number }): Promise<void> {
        const round = options.round;
        const { actor, encounter } = this;
        if (!encounter || !actor) return;

        // Run condition end of turn effects
        const activeConditions = actor.conditions.active;
        for (const condition of activeConditions) {
            await condition.onEndTurn({ token: this.token });
        }

        await this.update({ "flags.pf2e.roundOfLastTurnEnd": round });
        Hooks.callAll("pf2e.endTurn", this, encounter, game.user.id);
    }

    override prepareBaseData(): void {
        super.prepareBaseData();

        this.flags.pf2e = mergeObject(this.flags.pf2e ?? {}, { overridePriority: {} });
        this.flags.pf2e.roundOfLastTurn ??= null;
        this.flags.pf2e.initiativeStatistic ??= null;
    }

    /** Toggle the defeated status of this combatant, applying or removing the overlay icon on its token */
    async toggleDefeated(): Promise<void> {
        await this.update({ defeated: !this.defeated });
        await this.token?.object?.toggleEffect(game.settings.get("pf2e", "deathIcon"), { overlay: true });

        /** Remove this combatant's token as a target if it died */
        if (this.isDefeated && this.token?.object?.isTargeted) {
            this.token.object.setTarget(false, { releaseOthers: false });
        }
    }

    /**
     * Hide the tracked resource if the combatant represents a non-player-owned actor
     * @todo Make this a configurable with a metagame-knowledge setting
     */
    override updateResource(): { value: number } | null {
        if (this.isNPC && !game.user.isGM) return (this.resource = null);
        return super.updateResource();
    }

    override _getInitiativeFormula(): string {
        const { actor } = this;
        if (!actor) return "1d20";
        let bonus = 0;

        if (typeof actor.attributes.initiative?.totalModifier === "number") {
            bonus = actor.attributes.initiative.totalModifier;
        } else if (actor.attributes.perception) {
            bonus = actor.attributes.perception.value;
        }

        const parts = ["1d20", bonus || 0];

        return parts.join("+");
    }

    /** Toggle the visibility of names to players */
    async toggleNameVisibility(): Promise<void> {
        if (!this.token) return;

        const currentVisibility = this.token.displayName;

        const visibilityToggles = {
            [CONST.TOKEN_DISPLAY_MODES.ALWAYS]: CONST.TOKEN_DISPLAY_MODES.OWNER,
            [CONST.TOKEN_DISPLAY_MODES.CONTROL]: CONST.TOKEN_DISPLAY_MODES.HOVER,
            [CONST.TOKEN_DISPLAY_MODES.HOVER]: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
            [CONST.TOKEN_DISPLAY_MODES.NONE]: CONST.TOKEN_DISPLAY_MODES.HOVER,
            [CONST.TOKEN_DISPLAY_MODES.OWNER]: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
            [CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER]: CONST.TOKEN_DISPLAY_MODES.HOVER,
        };

        await this.token.update({ displayName: visibilityToggles[currentVisibility] });
    }

    /* -------------------------------------------- */
    /*  Event Listeners and Handlers                */
    /* -------------------------------------------- */

    protected override _onUpdate(
        changed: DeepPartial<this["_source"]>,
        options: DocumentUpdateContext<TParent>,
        userId: string
    ): void {
        super._onUpdate(changed, options, userId);

        // Reset actor data in case initiative order changed
        if (this.encounter?.started && typeof changed.initiative === "number") {
            this.encounter.resetActors();
        }

        // Send out a message with information on an automatic effect that occurs upon an actor's death
        if (changed.defeated && game.user.id === userId) {
            for (const action of this.actor?.itemTypes.action ?? []) {
                if (action.system.deathNote) {
                    action.toMessage(undefined, { rollMode: this.actor?.hasPlayerOwner ? "publicroll" : "gmroll" });
                }
            }
        }
    }

    protected override _onDelete(options: DocumentModificationContext<TParent>, userId: string): void {
        super._onDelete(options, userId);
        // Reset actor data in case initiative order changed
        if (this.encounter?.started) {
            this.encounter.resetActors();
        }
    }
}

interface CombatantPF2e<
    TParent extends EncounterPF2e | null = EncounterPF2e | null,
    TTokenDocument extends TokenDocumentPF2e | null = TokenDocumentPF2e | null
> extends Combatant<TParent, TTokenDocument> {
    flags: CombatantFlags;
}

interface CombatantFlags extends DocumentFlags {
    pf2e: {
        initiativeStatistic: SkillLongForm | "perception" | null;
        roundOfLastTurn: number | null;
        roundOfLastTurnEnd: number | null;
        overridePriority: Record<number, number | null | undefined>;
    };
}

type RolledCombatant<TEncounter extends EncounterPF2e> = CombatantPF2e<TEncounter, TokenDocumentPF2e> & {
    get initiative(): number;
};

export { CombatantPF2e, CombatantFlags, RolledCombatant };
