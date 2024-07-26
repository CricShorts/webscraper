angular.module('app.resources').factory('sites', function ($resource) {
	return $resource('/sites/:directory', { directory: '@directory' }, {
		list: { method: 'GET', isArray: false },
		get: { method: 'GET' },
		create: { method: 'POST' },
		// customGet: {
        //     method: 'GET',
        //     url: '/sites/custom/:customParam', // Replace with your custom URL
        //     params: { customParam: '@customParam' }
        // }
	});
});
