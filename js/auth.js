/**
 * MANEJO DE AUTENTICACIÓN Y SESIONES - SGN
 */

const sgnAuth = {
  /**
   * Iniciar Sesión (Super Admin o Docente)
   */
  login: function (emailCedula, passwordSecret) {
    return sgnApiCall("login", {
      email_cedula: emailCedula,
      password_secret: passwordSecret
    }).then(function (res) {
      if (res && res.success) {
        sessionStorage.setItem("sgn_user", JSON.stringify(res.user));
        return res;
      } else {
        throw new Error(res.message || "Credenciales inválidas.");
      }
    });
  },

  /**
   * Cerrar Sesión
   */
  logout: function () {
    sessionStorage.removeItem("sgn_user");
    window.location.href = "index.html";
  },

  /**
   * Obtener Usuario Actual
   */
  getCurrentUser: function () {
    const data = sessionStorage.getItem("sgn_user");
    return data ? JSON.parse(data) : null;
  },

  /**
   * Verificar si la sesión está activa
   */
  isLoggedIn: function () {
    return this.getCurrentUser() !== null;
  },

  /**
   * Verificar si el usuario actual es SUPER_ADMIN
   */
  isSuperAdmin: function () {
    const user = this.getCurrentUser();
    return user && user.rol === "SUPER_ADMIN";
  },

  /**
   * Verificar si el usuario actual es DOCENTE
   */
  isDocente: function () {
    const user = this.getCurrentUser();
    return user && user.rol === "DOCENTE";
  }
};
