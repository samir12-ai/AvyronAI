const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'server', 'mechanism-engine', 'engine.ts');
let content = fs.readFileSync(file, 'utf8');

const regex = /const depthGateMaxAttempts = DEPTH_GATE_MAX_RETRIES \+ 1;[\s\S]+?depthGateLog\.push\(\`Attempt \$\{depthAttempt\}: PASSED \(depthScore=\$\{celDepth\.causalDepthScore\}\)\`\);/m;

const replacement = `const depthGateMaxAttempts = DEPTH_GATE_MAX_RETRIES + 1;
  const depthGateLog: string[] = [];
  let currentAttempt = 1;

  const { generateWithRepair } = await import("../shared/llm-reliability/reliability-runner");
  const { result: validatedMechanism, telemetry } = await generateWithRepair({
    engineName: "MechanismEngine",
    touchpointName: "runMechanismEngineInternal",
    authoritativeInput: { prompt, primaryAxis, positioning, analyticalEnrichment, diffCore, accountId, pillars },
    maxRetries: DEPTH_GATE_MAX_RETRIES,
    generate: async (input) => {
      currentAttempt = 1;
      const response = await aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: input.prompt }],
        max_tokens: 4000,
        temperature: 0.7,
        accountId: input.accountId
      });
      return response?.choices?.[0]?.message?.content || "";
    },
    judge: async (input, candidate) => {
      let cleaned = candidate.replace(/\\x60\\x60\\x60json\\s*/g, "").replace(/\\x60\\x60\\x60\\s*/g, "").trim();
      let parsed = safeJsonParse(cleaned);
      if (!parsed || !parsed.primary) {
        return { valid: false, failureClass: "CONTRACT_FAILURE", rejections: [{ rule: "schema", reason: "Unparseable or missing primary key" }] };
      }

      const primaryMech = buildMechanismOutput(parsed.primary, input.primaryAxis, input.pillars);
      const altMech = parsed.alternative ? buildMechanismOutput(parsed.alternative, input.primaryAxis, input.pillars) : null;
      
      const nameValidation = validateMechanismName(primaryMech.mechanismName, input.positioning.domainVocab);
      if (!nameValidation.valid) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "name", reason: nameValidation.reason }] };
      }

      const sanitizedPrimary = applySoftSanitization(primaryMech.mechanismDescription, []);
      if (sanitizedPrimary !== primaryMech.mechanismDescription) {
        primaryMech.mechanismDescription = sanitizedPrimary;
      }

      const axisValidation = validateMechanismAxisAlignment(primaryMech, input.primaryAxis);
      if (!axisValidation.consistent && input.diffCore) {
        primaryMech.axisAlignment.primaryAxis = input.primaryAxis;
        const emphasisFromDiff = extractAxisEmphasisFromCore(input.diffCore, input.primaryAxis);
        if (emphasisFromDiff.length > 0) {
          primaryMech.axisAlignment.axisEmphasis = [...new Set([...primaryMech.axisAlignment.axisEmphasis, ...emphasisFromDiff])];
        }
      }

      const finalValidation = validateMechanismAxisAlignment(primaryMech, input.primaryAxis);

      const celSourceTexts = [
        primaryMech.mechanismDescription,
        primaryMech.mechanismLogic,
        primaryMech.mechanismPromise,
        primaryMech.mechanismProblem,
        ...primaryMech.mechanismSteps,
      ];
      const celDepth = enforceEngineDepthCompliance("mechanism", celSourceTexts, input.analyticalEnrichment || null);
      
      if (input.analyticalEnrichment && isDepthBlocking(celDepth, celSourceTexts)) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "depth", reason: JSON.stringify(celDepth) }] };
      }

      return { valid: true, recoveredValue: { parsed, primaryMech, altMech, celDepth, finalValidation, celSourceTexts } };
    },
    repair: async (input, failedContent, rejections) => {
      currentAttempt++;
      const schemaRejection = rejections.find(r => r.rule === "schema");
      if (schemaRejection) {
        const strictPrompt = \`\${input.prompt}\\n\\n═══ STRICT OUTPUT FORMAT (PREVIOUS RESPONSE WAS UNPARSEABLE) ═══\\nRespond with EXACTLY ONE valid JSON object and NOTHING else. No markdown, no preamble, no explanation. Start your response with "{" and end with "}". The top-level object MUST contain a "primary" key.\`;
        const response = await aiChat({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: strictPrompt }],
          max_tokens: 4000,
          temperature: 0.3,
          accountId: input.accountId
        });
        return response?.choices?.[0]?.message?.content || "";
      }

      const nameRejection = rejections.find(r => r.rule === "name");
      if (nameRejection) {
        let cleaned = failedContent.replace(/\\x60\\x60\\x60json\\s*/g, "").replace(/\\x60\\x60\\x60\\s*/g, "").trim();
        let parsed = safeJsonParse(cleaned);
        if (parsed && parsed.primary) {
          const nameRepairResponse = await aiChat({
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: \`The mechanism name "\${parsed.primary.name}" is invalid because: \${nameRejection.reason}.\\n\\nRename it to satisfy ALL THREE requirements:\\n1. DOMAIN OBJECT: A noun specific to this business context: "\${input.positioning.contrastAxis || input.primaryAxis}" with enemy: "\${input.positioning.enemyDefinition || "unknown"}"\\n2. OPERATIONAL ACTION: One of: Diagnostic, Extraction, Audit, Pipeline, Conversion, Qualification, Validation, Assessment, Protocol, Mapping, Tracker\\n3. UNIQUE IDENTITY: Must reference the "\${input.primaryAxis}" axis or the specific domain problem\\n\\nReturn ONLY the new mechanism name as a JSON object: {"name": "The [Domain Object] [Action] [Identity]"}\` }],
            max_tokens: 100,
            temperature: 0.3,
            endpoint: "mechanism-name-repair",
            accountId: input.accountId
          });
          const repairContent = nameRepairResponse?.choices?.[0]?.message?.content?.trim() || "";
          const repairParsed = safeJsonParse(repairContent.replace(/\\x60\\x60\\x60json\\s*/g, "").replace(/\\x60\\x60\\x60\\s*/g, "").trim());
          if (repairParsed?.name && typeof repairParsed.name === "string" && repairParsed.name.trim()) {
            parsed.primary.name = repairParsed.name.trim();
            return JSON.stringify(parsed);
          }
        }
      }

      const depthRejection = rejections.find(r => r.rule === "depth");
      if (depthRejection) {
        const celDepth = JSON.parse(depthRejection.reason);
        const depthRejectionContext = buildDepthRejectionDirective(celDepth, currentAttempt);
        const fullPrompt = \`\${input.prompt}\\n\\n\${depthRejectionContext}\`;
        const response = await aiChat({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: fullPrompt }],
          max_tokens: 4000,
          temperature: 0.7,
          accountId: input.accountId
        });
        return response?.choices?.[0]?.message?.content || "";
      }

      return failedContent;
    }
  });

  if (!validatedMechanism) {
    const fallbackMech = buildFallbackMechanism(diffCore, primaryAxis);
    const hasUsableFallback = !!(diffCore && diffCore.mechanismType !== "none" && diffCore.mechanismName);
    return {
      status: hasUsableFallback ? STATUS.COMPLETE : STATUS.FAILED,
      statusMessage: hasUsableFallback
        ? \`AI generation unparseable — using differentiation-core fallback (axis="\${primaryAxis}" propagated deterministically; confidence reduced)\`
        : \`AI generation unparseable and no differentiation-core fallback available (axis="\${primaryAxis}" propagated deterministically)\`,
      primaryMechanism: fallbackMech,
      alternativeMechanism: null,
      axisConsistency: {
        consistent: hasUsableFallback,
        primaryAxis,
        mechanismAxis: primaryAxis,
        failures: hasUsableFallback ? [] : ["AI generation failed and no differentiation-core fallback available"],
      },
      confidenceScore: hasUsableFallback ? 0.4 : 0.3,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      diagnostics,
    };
  }

  const { parsed, primaryMech, altMech, celDepth, finalValidation, celSourceTexts } = validatedMechanism as any;
  const depthAttempt = telemetry.attempts;
  
  const aelRefs = [parsed.primary, parsed.alternative].filter(Boolean);
  const rcHits = aelRefs.filter((r: any) => r.rootCauseUsed && /\\[RC\\d+\\]/.test(r.rootCauseUsed)).length;
  const bbHits = aelRefs.filter((r: any) => r.barrierResolved && /\\[BB\\d+\\]/.test(r.barrierResolved)).length;
  console.log(\`[MechanismEngine] AEL_GROUNDING_RESULT | mechanisms=\${aelRefs.length} | rootCauseRefs=\${rcHits}/\${aelRefs.length} | barrierRefs=\${bbHits}/\${aelRefs.length}\`);
  const mechGroundingRefs: string[] = Array.isArray(parsed.groundingRefs)
    ? parsed.groundingRefs.filter((r: any) => typeof r === "string" && r.trim().length > 0).map((r: string) => r.trim())
    : [];
  checkGroundingContract({
    engine: "mechanism",
    site: "primary_mechanism",
    groundingRefs: mechGroundingRefs,
    ael: analyticalEnrichment || null,
    accountId,
    attemptNumber: depthAttempt,
  });

  diagnostics.celDepthCompliance = celDepth;
  diagnostics.axisValidation = finalValidation;
  
  depthGateLog.push(\`Attempt \${depthAttempt}: PASSED (depthScore=\${celDepth.causalDepthScore})\`);`;

content = content.replace(regex, replacement);
fs.writeFileSync(file, content, 'utf8');
console.log('Done!');
