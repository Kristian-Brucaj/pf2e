import { ItemType } from "@item/data";
import { MagicTradition } from "@item/spell/types";
import { BaseRawModifier } from "@actor/modifiers";
import { DegreeAdjustmentsRecord, DegreeOfSuccessString } from "@system/degree-of-success";
import { RollNoteSource } from "@module/notes";
import { CheckRollContext } from "@system/check";
import { DamageRollContext } from "@system/damage";
import { ZeroToTwo } from "@module/data";

interface ChatMessageSourcePF2e extends foundry.documents.ChatMessageSource {
    flags: ChatMessageFlagsPF2e;
}

type ChatMessageFlagsPF2e = foundry.documents.ChatMessageFlags & {
    pf2e: {
        damageRoll?: DamageRollFlag;
        context?: ChatContextFlag;
        origin?: { type: ItemType; uuid: string } | null;
        casting?: { id: string; level: number; tradition: MagicTradition } | null;
        modifierName?: string;
        modifiers?: BaseRawModifier[];
        preformatted?: "flavor" | "content" | "both";
        isFromConsumable?: boolean;
        journalEntry?: DocumentUUID;
        spellVariant?: { overlayIds: string[] };
        strike?: StrikeLookupData | null;
        [key: string]: unknown;
    };
    core: NonNullable<foundry.documents.ChatMessageFlags["core"]>;
};

type ChatContextFlag = CheckRollContextFlag | DamageRollContextFlag | SpellCastContextFlag;

/** Data used to lookup a strike on an actor */
interface StrikeLookupData {
    actor: ActorUUID | TokenDocumentUUID;
    index: number;
    damaging: boolean;
    name: string;
    altUsage?: "thrown" | "melee" | null;
}

interface DamageRollFlag {
    outcome: DegreeOfSuccessString;
    total: number;
    traits: string[];
    types: Record<string, Record<string, number>>;
    diceResults: Record<string, Record<string, DieResult[]>>;
    baseDamageDice: number;
}

interface DieResult {
    faces: number;
    result: number;
}

interface TargetFlag {
    actor: ActorUUID | TokenDocumentUUID;
    token?: TokenDocumentUUID;
}

type ContextFlagOmission =
    | "actor"
    | "altUsage"
    | "createMessage"
    | "dosAdjustments"
    | "item"
    | "mapIncreases"
    | "notes"
    | "options"
    | "target"
    | "token";

interface CheckRollContextFlag extends Required<Omit<CheckRollContext, ContextFlagOmission>> {
    actor: string | null;
    token: string | null;
    item?: undefined;
    dosAdjustments?: DegreeAdjustmentsRecord;
    target: TargetFlag | null;
    altUsage?: "thrown" | "melee" | null;
    notes: RollNoteSource[];
    options: string[];
}

interface DamageRollContextFlag extends Required<Omit<DamageRollContext, ContextFlagOmission | "self">> {
    actor: string | null;
    token: string | null;
    item?: undefined;
    mapIncreases?: ZeroToTwo;
    target: TargetFlag | null;
    notes: RollNoteSource[];
    options: string[];
}

interface SpellCastContextFlag {
    type: "spell-cast";
    domains: string[];
    options: string[];
    /** The roll mode (i.e., 'roll', 'blindroll', etc) to use when rendering this roll. */
    rollMode?: RollMode;
}

export {
    ChatContextFlag,
    ChatMessageSourcePF2e,
    ChatMessageFlagsPF2e,
    CheckRollContextFlag,
    DamageRollFlag,
    DamageRollContextFlag,
    StrikeLookupData,
    TargetFlag,
};
