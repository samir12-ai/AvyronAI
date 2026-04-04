export function assessStrategyAcceptability(confidence, layersPassed, totalLayers, integrityPassed, structuralWarnings) {
    const passRate = totalLayers > 0 ? layersPassed / totalLayers : 0;
    const warningCount = structuralWarnings.length;
    const reasons = [];
    if (confidence > 0.7 && passRate >= 0.8 && integrityPassed && warningCount <= 2) {
        reasons.push(`High confidence (${(confidence * 100).toFixed(0)}%)`);
        reasons.push(`${layersPassed}/${totalLayers} layers passed`);
        if (warningCount > 0)
            reasons.push(`${warningCount} minor warning(s)`);
        return {
            grade: "green",
            confidence,
            label: "Strong strategy — all validation layers passed with high confidence",
            adaptiveFallback: "Execute as designed — no fallback needed",
            reasons,
        };
    }
    if (confidence >= 0.5 && confidence <= 0.7 && passRate >= 0.5) {
        reasons.push(`Moderate confidence (${(confidence * 100).toFixed(0)}%)`);
        reasons.push(`${layersPassed}/${totalLayers} layers passed`);
        if (!integrityPassed)
            reasons.push("Minor integrity validation failures detected");
        if (warningCount > 2)
            reasons.push(`${warningCount} structural warning(s)`);
        return {
            grade: "yellow",
            confidence,
            label: "Risky but viable — minor validation gaps detected",
            adaptiveFallback: "Proceed with conservative defaults and enhanced monitoring",
            reasons,
        };
    }
    if (confidence >= 0.3 && confidence < 0.5) {
        reasons.push(`Low confidence (${(confidence * 100).toFixed(0)}%)`);
        reasons.push(`${layersPassed}/${totalLayers} layers passed`);
        if (!integrityPassed)
            reasons.push("Significant integrity failures");
        if (warningCount > 0)
            reasons.push(`${warningCount} structural warning(s)`);
        return {
            grade: "orange",
            confidence,
            label: "Difficult conditions — significant data or validation gaps",
            adaptiveFallback: "Use simplified strategy with maximum safety margins and fallback positioning",
            reasons,
        };
    }
    reasons.push(`Very low confidence (${(confidence * 100).toFixed(0)}%)`);
    if (totalLayers > 0)
        reasons.push(`Only ${layersPassed}/${totalLayers} layers passed`);
    if (!integrityPassed)
        reasons.push("Major integrity failures");
    if (warningCount > 0)
        reasons.push(`${warningCount} structural warning(s)`);
    return {
        grade: "red",
        confidence,
        label: "Structurally unlikely — major failures detected but adaptive path provided",
        adaptiveFallback: "Deploy minimal viable strategy with education-first approach and maximum risk reduction",
        reasons,
    };
}
