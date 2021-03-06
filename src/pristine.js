import 'regenerator-runtime';
import { lang } from './lang';
import { tmpl, findAncestor, groupedElemCount, mergeConfig, isFunction, findAncestorByAttr } from './utils';

let defaultConfig = {
    classTo: 'form-group',
    errorClass: 'has-danger',
    successClass: 'has-success',
    loadingClass: 'has-loading',
    errorTextParent: 'form-group',
    errorTextTag: 'div',
    errorTextClass: 'text-help',
    loadingText: 'Validating&hellip;',
};

const PRISTINE_ERROR = 'pristine-error';
const PRISTINE_EXCLUDE_ATTRIBUTE = 'data-pristine-exclude';
const SELECTOR = "input:not([type^=hidden]):not([type^=submit]), select, textarea";
const ALLOWED_ATTRIBUTES = ["required", "min", "max", 'minlength', 'maxlength', 'pattern'];
const EMAIL_REGEX = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

const validators = {};

const _ = function (name, validator) {
    validator.name = name;
    if (!validator.msg)
        validator.msg = lang[name];
    if (validator.priority === undefined)
        validator.priority = 1;
    validators[name] = validator;
};

_('text', { fn: (val) => true, priority: 0});
_('required', { fn: function(val){ return (this.type === 'radio' || this.type === 'checkbox') ? groupedElemCount(this) : val !== undefined && val !== ''}, priority: 99, halt: true});
_('email', { fn: (val) => !val || EMAIL_REGEX.test(val)});
_('number', { fn: (val) => !val || !isNaN(parseFloat(val)), priority: 2 });
_('integer', { fn: (val) => val && /^\d+$/.test(val) });
_('minlength', { fn: (val, length) => !val || val.length >= parseInt(length) });
_('maxlength', { fn: (val, length) => !val || val.length <= parseInt(length) });
_('min', { fn: function(val, limit){ return !val || (this.type === 'checkbox' ? groupedElemCount(this) >= parseInt(limit) : parseFloat(val) >= parseFloat(limit)); } });
_('max', { fn: function(val, limit){ return !val || (this.type === 'checkbox' ? groupedElemCount(this) <= parseInt(limit) : parseFloat(val) <= parseFloat(limit)); } });
_('pattern', { fn: (val, pattern) => { let m = pattern.match(new RegExp('^/(.*?)/([gimy]*)$')); return !val || (new RegExp(m[1], m[2])).test(val);} });


export default function Pristine(form, config, live){

    let self = this;

    init(form, config, live);

    function init(form, config, live){

        form.setAttribute("novalidate", "true");

        self.form = form;
        self.config = mergeConfig(config || {}, defaultConfig);
        self.live = !(live === false);
        self.fields = Array.from(form.querySelectorAll(SELECTOR)).map(function (input) {

            let fns = [];
            let params = {};
            let messages = {};

            [].forEach.call(input.attributes, function (attr) {
                if (/^data-pristine-/.test(attr.name)) {
                    let name = attr.name.substr(14);
                    if (name.endsWith('-message')){
                        messages[name.slice(0, name.length-8)] = attr.value;
                        return;
                    }
                    if (name === 'type') name = attr.value;
                    _addValidatorToField(fns, params, name, attr.value);
                } else if (~ALLOWED_ATTRIBUTES.indexOf(attr.name)){
                    _addValidatorToField(fns, params, attr.name, attr.value);
                } else if (attr.name === 'type'){
                    _addValidatorToField(fns, params, attr.value);
                }
            });

            fns.sort( (a, b) => b.priority - a.priority);

            self.live && input.addEventListener((!~['radio', 'checkbox'].indexOf(input.getAttribute('type')) ? 'input':'change'), function(e) {
                self.validate(e.target);
            }.bind(self));

            return input.pristine = {input, validators: fns, params, messages, self};

        }.bind(self));
    }

    function _addValidatorToField(fns, params, name, value) {
        let validator = validators[name];
        if (validator) {
            fns.push(validator);
            if (value) {
                let valueParams = name === 'pattern' ? [value] : value.split(',');
                valueParams.unshift(null); // placeholder for input's value
                params[name] = valueParams;
            }
        }
    }

    function _isFieldExcluded(field) {
        let input = field.input;
        if (input.hasAttribute(PRISTINE_EXCLUDE_ATTRIBUTE) || findAncestorByAttr(input, PRISTINE_EXCLUDE_ATTRIBUTE)) {
            return true;
        }
    }

    /***
     * Checks whether the form/input elements are valid
     * @param input => input element(s) or a jquery selector, null for full form validation
     * @param silent => do not show error messages, just return true/false
     * @returns {boolean} return true when valid false otherwise
     */
    self.validate = async function(input, silent){
        silent = (input && silent === true) || input === true;
        let fields = self.fields;
        if (input !== true && input !== false){
            if (input instanceof HTMLElement) {
                fields = [input.pristine];
            } else if (input instanceof NodeList || input instanceof (window.$ || Array) || input instanceof Array){
                fields = Array.from(input).map(el => el.pristine);
            }
        }

        let promises = [];
        for (let i in fields){
            let field = fields[i];
            if (_isFieldExcluded(field)) {
                if (field.errors !== undefined && field.errors.length > 0) {
                    field.errors = [];
                    _removeError(field);
                }
                continue;
            }

            promises.push(_performFieldValidation(field));   
        }

        let validationResults = await Promise.all(promises);
        for (let i in validationResults) {
            let fieldResult = validationResults[i];
            if (!fieldResult) return false;
        }

        return true;
    };

    /***
     * Get errors of a specific field or the whole form
     * @param input
     * @returns {Array|*}
     */
    self.getErrors = function(input) {
        if (!input){
            let erroneousFields = [];
            for(let i=0; i<self.fields.length; i++){
                let field = self.fields[i];
                if (field.errors.length){
                    erroneousFields.push({input: field.input, errors: field.errors});
                }
            }
            return erroneousFields;
        }
        return input.length ? input[0].pristine.errors : input.pristine.errors;
    };

    /***
     * Validates a single field, all validator functions are called and error messages are generated
     * when a validator fails
     * @param field
     * @returns {boolean}
     * @private
     */
    async function _validateField(field){
        field.errors = [];

        for(let i in field.validators){
            let validator = field.validators[i];
            let params = field.params[validator.name] ? field.params[validator.name] : [];
            params[0] = field.input.value;

            _showLoading(field);
            let result = await validator.fn.apply(field.input, params)

            field.errors = [];
            if (!result) {
                if (isFunction(validator.msg)) {
                    field.errors.push(validator.msg(field.input.value, params))
                } else {
                    let error = field.messages[validator.name] || validator.msg;
                    field.errors.push(tmpl.apply(error, params));
                }

                return false;
            }
        }

        return true;
    }

    async function _performFieldValidation(field) {
        let isFieldValid = await _validateField(field);
        if (isFieldValid){
            _showSuccess(field);
        } else {
            _showError(field);
        }

        return isFieldValid;
    }

    /***
     *
     * @param elem => The dom element where the validator is applied to
     * @param fn => validator function
     * @param msg => message to show when validation fails. Supports templating. ${0} for the input's value, ${1} and
     * so on are for the attribute values
     * @param priority => priority of the validator function, higher valued function gets called first.
     * @param halt => whether validation should stop for this field after current validation function
     */
    self.addValidator = function(elem, fn, msg, priority, halt){
        if (elem instanceof HTMLElement){
            elem.pristine.validators.push({fn, msg, priority, halt});
            elem.pristine.validators.sort( (a, b) => b.priority - a.priority);
        } else {
            console.warn("The parameter elem must be a dom element");
        }
    };

    /***
     * An utility function that returns a 2-element array, first one is the element where error/success class is
     * applied. 2nd one is the element where error message is displayed. 2nd element is created if doesn't exist and cached.
     * @param field
     * @returns {*}
     * @private
     */
    function _getErrorElements(field) {
        if (field.errorElements){
            return field.errorElements;
        }
        let errorClassElement = findAncestor(field.input, self.config.classTo);
        let errorTextParent = null, errorTextElement = null;
        if (self.config.classTo === self.config.errorTextParent){
            errorTextParent = errorClassElement;
        } else {
            errorTextParent = errorClassElement.querySelector('.' + self.config.errorTextParent);
        }
        if (errorTextParent){
            errorTextElement = errorTextParent.querySelector('.' + PRISTINE_ERROR);
            if (!errorTextElement){
                errorTextElement = document.createElement(self.config.errorTextTag);
                errorTextElement.className = PRISTINE_ERROR + ' ' + self.config.errorTextClass;
                errorTextParent.appendChild(errorTextElement);
                errorTextElement.pristineDisplay = errorTextElement.style.display;
            }
        }
        return field.errorElements = [errorClassElement, errorTextElement]
    }

    function _showError(field){
        let errorElements = _getErrorElements(field);
        let errorClassElement = errorElements[0], errorTextElement = errorElements[1];

        if(errorClassElement){
            errorClassElement.classList.remove(self.config.successClass);
            errorClassElement.classList.remove(self.config.loadingClass);
            errorClassElement.classList.add(self.config.errorClass);
        }

        if (errorTextElement){
            errorTextElement.innerHTML = field.errors.join('<br/>');
            errorTextElement.classList.remove(self.config.loadingClass);
            errorTextElement.classList.remove(self.config.successClass);
            errorTextElement.style.display = errorTextElement.pristineDisplay || '';
        }
    }

    function _showLoading(field){
        let errorElements = _getErrorElements(field);
        let errorClassElement = errorElements[0], errorTextElement = errorElements[1];

        if(errorClassElement){
            errorClassElement.classList.remove(self.config.successClass);
            errorClassElement.classList.remove(self.config.errorClass);
            errorClassElement.classList.add(self.config.loadingClass);
        }

        if (errorTextElement){
            errorTextElement.innerHTML = self.config.loadingText;
            errorTextElement.classList.remove(self.config.successClass);
            errorTextElement.classList.add(self.config.loadingClass);
            errorTextElement.style.display = errorTextElement.pristineDisplay || '';
        }
    }

    /***
     * Adds error to a specific field
     * @param input
     * @param error
     */
    self.addError = function(input, error) {
        input = input.length ? input[0] : input;
        input.pristine.errors.push(error);
        _showError(input.pristine);
    };

    function _removeError(field){
        let errorElements = _getErrorElements(field);
        let errorClassElement = errorElements[0], errorTextElement = errorElements[1];
        if (errorClassElement){
            // IE > 9 doesn't support multiple class removal
            errorClassElement.classList.remove(self.config.errorClass);
            errorClassElement.classList.remove(self.config.successClass);
            errorClassElement.classList.remove(self.config.loadingClass);
        }
        if (errorTextElement){
            errorTextElement.innerHTML = '';
            errorTextElement.classList.remove(self.config.loadingClass);
            errorTextElement.classList.remove(self.config.successClass);
            errorTextElement.style.display = 'none';
        }
        return errorElements;
    }

    function _showSuccess(field){
        let errorElements = _removeError(field);

        if (!field.input.required && field.input.value === '') {
            return;
        }

        let errorClassElement = errorElements[0], errorTextElement = errorElements[1];
        if (errorClassElement){
            errorClassElement.classList.add(self.config.successClass)
        }

        if (errorTextElement){
            if (field.input.getAttribute('data-pristine-success-message') !== null) {
                errorTextElement.innerHTML = field.input.getAttribute('data-pristine-success-message');
                errorTextElement.classList.remove(self.config.loadingClass);
                errorTextElement.classList.add(self.config.successClass);
                errorTextElement.style.display = errorTextElement.pristineDisplay || '';
            }
        }
    }

    /***
     * Resets the errors
     */
    self.reset = function () {
        for(let i in self.fields){
            self.fields[i].errorElements = null;
        }
        Array.from(self.form.querySelectorAll('.' + PRISTINE_ERROR)).map(function (elem) {
            elem.parentNode.removeChild(elem);
        });
        Array.from(self.form.querySelectorAll('.' + self.config.classTo)).map(function (elem) {
            elem.classList.remove(self.config.successClass);
            elem.classList.remove(self.config.errorClass);
            elem.classList.remove(self.config.loadingClass);
        });

    };

    /***
     * Resets the errors and deletes all pristine fields
     */
    self.destroy = function(){
        self.reset();
        self.fields.forEach(function (field) {
            delete field.input.pristine;
        });
        self.fields = [];
    };

    self.setGlobalConfig = function (config) {
        defaultConfig = config;
    };

    return self;

}

/***
 *
 * @param name => Name of the global validator
 * @param fn => validator function
 * @param msg => message to show when validation fails. Supports templating. ${0} for the input's value, ${1} and
 * so on are for the attribute values
 * @param priority => priority of the validator function, higher valued function gets called first.
 * @param halt => whether validation should stop for this field after current validation function
 */
Pristine.addValidator = function(name, fn, msg, priority, halt){
    _(name, {fn, msg, priority, halt});
};
