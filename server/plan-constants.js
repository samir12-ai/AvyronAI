export const ACTIVE_PLAN_STATUSES = [
    'APPROVED',
    'GENERATED_TO_CALENDAR',
    'CREATIVE_GENERATED',
    'REVIEW',
    'SCHEDULED',
];
export const ACTIVE_PLAN_STATUSES_SQL = ACTIVE_PLAN_STATUSES.map(s => `'${s}'`).join(', ');
