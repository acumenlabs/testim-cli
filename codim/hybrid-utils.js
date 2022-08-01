'use strict';

module.exports.getArgumentsFromContext = async function getArgumentsFromContext(
    step,
    context,
    locatorStrategy
)  {
    const argsInCorrectOrder = fixArgsOrdering(step.parameterNames.map(p => p.displayName), context.incomingParams.as);

    return await Promise.all(argsInCorrectOrder.map(arg => {
        if (typeof arg === 'object' && arg.locatedElement) {
            return locatorStrategy(arg);
        }
        return arg;
    }));
};

function fixArgsOrdering(parametersInOrder, incomingParamsAs) {
    const finalList = [];

    for (const p of parametersInOrder) {
        // this is expected to always find index
        const index = incomingParamsAs.functionParameters.indexOf(p);
        finalList.push(incomingParamsAs.functionArguments[index]);
    }

    return finalList;
}
