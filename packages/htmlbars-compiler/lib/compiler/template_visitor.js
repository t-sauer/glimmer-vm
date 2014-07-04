var push = Array.prototype.push;

function Frame() {
  this.parentNode = null;
  this.childIndex = null;
  this.childCount = null;
  this.childTemplateCount = 0;
  this.mustacheCount = 0;
  this.actions = [];
}

/**
 * Takes in an AST and outputs a list of actions to be consumed
 * by a compiler. For example, the template
 *
 *     foo{{bar}}<div>baz</div>
 *
 * produces the actions
 *
 *     [['startProgram', [programNode, 0]],
 *      ['text', [textNode, 0, 3]],
 *      ['mustache', [mustacheNode, 1, 3]],
 *      ['openElement', [elementNode, 2, 3, 0]],
 *      ['text', [textNode, 0, 1]],
 *      ['closeElement', [elementNode, 2, 3],
 *      ['endProgram', [programNode]]]
 *
 * This visitor walks the AST depth first and backwards. As
 * a result the bottom-most child template will appear at the
 * top of the actions list whereas the root template will appear
 * at the bottom of the list. For example,
 *
 *     <div>{{#if}}foo{{else}}bar<b></b>{{/if}}</div>
 *
 * produces the actions
 *
 *     [['startProgram', [programNode, 0]],
 *      ['text', [textNode, 0, 2, 0]],
 *      ['openElement', [elementNode, 1, 2, 0]],
 *      ['closeElement', [elementNode, 1, 2]],
 *      ['endProgram', [programNode]],
 *      ['startProgram', [programNode, 0]],
 *      ['text', [textNode, 0, 1]],
 *      ['endProgram', [programNode]],
 *      ['startProgram', [programNode, 2]],
 *      ['openElement', [elementNode, 0, 1, 1]],
 *      ['block', [blockNode, 0, 1]],
 *      ['closeElement', [elementNode, 0, 1]],
 *      ['endProgram', [programNode]]]
 *
 * The state of the traversal is maintained by a stack of frames.
 * Whenever a node with children is entered (either a ProgramNode
 * or an ElementNode) a frame is pushed onto the stack. The frame
 * contains information about the state of the traversal of that
 * node. For example,
 * 
 *   - index of the current child node being visited
 *   - the number of mustaches contained within its child nodes
 *   - the list of actions generated by its child nodes
 */

function TemplateVisitor() {
  this.frameStack = [];
  this.actions = [];
}

// Traversal methods

TemplateVisitor.prototype.visit = function(node) {
  this[node.type](node);
};

TemplateVisitor.prototype.program = function(program) {
  var parentFrame = this.getCurrentFrame();
  var programFrame = this.pushFrame();

  programFrame.parentNode = program;
  programFrame.childCount = program.statements.length;
  programFrame.actions.push(['endProgram', [program]]);

  for (var i = program.statements.length - 1; i >= 0; i--) {
    programFrame.childIndex = i;
    this.visit(program.statements[i]);
  }

  programFrame.actions.push(['startProgram', [program, programFrame.childTemplateCount]]);
  this.popFrame();

  // Push the completed template into the global actions list
  if (parentFrame) { parentFrame.childTemplateCount++; }
  push.apply(this.actions, programFrame.actions.reverse());
};

TemplateVisitor.prototype.element = function(element) {
  var parentFrame = this.getCurrentFrame();
  var elementFrame = this.pushFrame();
  var parentNode = parentFrame.parentNode;

  elementFrame.parentNode = element;
  elementFrame.childCount = element.children.length;
  elementFrame.mustacheCount += element.helpers.length;

  var actionArgs = [
    element,
    parentFrame.childIndex,
    parentFrame.childCount,
    parentNode.type === 'program' && parentFrame.childCount === 1
  ];

  elementFrame.actions.push(['closeElement', actionArgs]);

  for (var i = element.attributes.length - 1; i >= 0; i--) {
    this.visit(element.attributes[i]);
  }

  for (i = element.children.length - 1; i >= 0; i--) {
    elementFrame.childIndex = i;
    this.visit(element.children[i]);
  }

  elementFrame.actions.push(['openElement', actionArgs.concat(elementFrame.mustacheCount)]);
  this.popFrame();

  // Propagate the element's frame state to the parent frame
  if (elementFrame.mustacheCount > 0) { parentFrame.mustacheCount++; }
  parentFrame.childTemplateCount += elementFrame.childTemplateCount;
  push.apply(parentFrame.actions, elementFrame.actions);
};

TemplateVisitor.prototype.attr = function(attr) {
  if (attr.value.type === 'mustache') {
    this.getCurrentFrame().mustacheCount++;
  }
};

TemplateVisitor.prototype.block = function(node) {
  var frame = this.getCurrentFrame();
  var parentNode = frame.parentNode;

  frame.mustacheCount++;
  frame.actions.push([node.type, [node, frame.childIndex, frame.childCount]]);

  if (node.inverse) { this.visit(node.inverse); }
  if (node.program) { this.visit(node.program); }
};

TemplateVisitor.prototype.component = TemplateVisitor.prototype.block;

TemplateVisitor.prototype.text = function(text) {
  var frame = this.getCurrentFrame();
  var isSingleRoot = frame.parentNode.type === 'program' && frame.childCount === 1;
  frame.actions.push(['text', [text, frame.childIndex, frame.childCount, isSingleRoot]]);
};

TemplateVisitor.prototype.mustache = function(mustache) {
  var frame = this.getCurrentFrame();
  frame.mustacheCount++;
  frame.actions.push(['mustache', [mustache, frame.childIndex, frame.childCount]]);
};

// Frame helpers

TemplateVisitor.prototype.getCurrentFrame = function() {
  return this.frameStack[this.frameStack.length - 1];
};

TemplateVisitor.prototype.pushFrame = function() {
  var frame = new Frame();
  this.frameStack.push(frame);
  return frame;
};

TemplateVisitor.prototype.popFrame = function() {
  return this.frameStack.pop();
};

export default TemplateVisitor;
