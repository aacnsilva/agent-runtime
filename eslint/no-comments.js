export const noComments = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      banned: "Comments are banned. Express intent through names, types and small functions.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: "banned" });
        }
      },
    };
  },
};
