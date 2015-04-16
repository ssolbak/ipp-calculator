function helpers(Handlebars, _) {
    return {

        formatDate: function(date, format) {
            var f = (typeof(format) == 'string') ? format : 'M D, h:m';
            return formatDate(date, f);
        },

        ifCond: function (v1, operator, v2, options) {

            var a = options.fn(this),
                b = options.inverse(this);

            switch (operator) {
                case '!=':
                    return (v1 != v2) ? a : b;
                case '!==':
                    return (v1 !== v2) ? a : b;
                case '==':
                    return (v1 == v2) ? a : b;
                case '===':
                    return (v1 === v2) ? a : b;
                case '<':
                    return (v1 < v2) ? a : b;
                case '<=':
                    return (v1 <= v2) ? a : b;
                case '>':
                    return (v1 > v2) ? a : b;
                case '>=':
                    return (v1 >= v2) ? a : b;
                case '&&':
                    return (v1 && v2) ? a : b;
                case '||':
                    return (v1 || v2) ? a : b;
                case 'in':
                    var list = JSON.parse(v2);
                    return (list.indexOf(v1) >=0) ? a : b;
                default:
                    return b;
            }
        },

        percent: function(num, digits) {
            return _toFixed(num*100, digits || 2);
        },

        toFixed: function(num, digits) {
            return _toFixed(num, digits);
        },

        year : function(year){
            return year.substring(2);
        }

    };

    function formatDate(date, format) {
        format = format || 'M D, h:m';
        var months = [
            ['Jan', 'January'],
            ['Feb', 'February'],
            ['Mar', 'March'],
            ['Apr', 'April'],
            ['May', 'May'],
            ['Jun', 'June'],
            ['Jul', 'July'],
            ['Aug', 'August'],
            ['Sep', 'September'],
            ['Oct', 'October'],
            ['Nov', 'November'],
            ['Dec', 'December' ]
        ];
        var d = new Date(date);

        var years = d.getFullYear();

        var hours = d.getHours();
        if (hours < 10) hours = '0' + hours;

        var minutes = d.getMinutes();
        if (minutes < 10) minutes = '0' + minutes;

        var month = months[d.getMonth()] || ['?', '?'];
        var day = d.getDate();

        _.chain([
            { key: 'M', value: month[0]},
            { key: 'O', value: month[1]},
            { key: 'D', value: day},
            { key: 'h', value: hours},
            { key: 'm', value: minutes},
            { key: 'y', value: years}
        ])
            .map(function (item) {
                return {
                    index: format.indexOf(item.key),
                    value: item.value
                }
            })
            .reject(function (item) {
                return item.index == -1;
            })
            .sortBy(function (item) {
                return -item.index;
            })
            .each(function (item) {
                format = format.slice(0, item.index) + item.value + format.slice(item.index + 1)
            });

        return format;
    }

    function _toFixed(num, digits){
        return (num == null || isNaN(num) || !num.toFixed) ? num : num.toFixed(digits);
    }
}


module.exports = helpers(require('handlebars'), require('lodash'));


