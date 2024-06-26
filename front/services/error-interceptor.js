angular.module('app').factory('errorInterceptor', ['$rootScope', '$q',
	function ($rootScope, $q) {
		return {
			request: function request (config) {
				$rootScope.hasErrors = false;
				$rootScope.errorMessage = null;
				return config;
			},
			responseError: function responseError (rejection) {
				$rootScope.hasErrors = true;
				return $q.reject(rejection);
			}
		};
}]);
