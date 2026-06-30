package v1alpha1

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// IssuerSpec defines the desired state of an Issuer / ClusterIssuer.
type IssuerSpec struct {
	// URL of the PKI Manager external API (e.g. https://pki.example.com)
	// +kubebuilder:validation:Pattern=`^https?://.+`
	URL string `json:"url"`

	// CA ID in PKI Manager that this issuer maps to.
	// +kubebuilder:validation:MinLength=1
	CAID string `json:"caId"`

	// Optional CA bundle (PEM) used to verify TLS connection to PKI Manager.
	// +optional
	CABundle []byte `json:"caBundle,omitempty"`

	// Reference to a Secret in the same namespace (Issuer) or the controller's
	// namespace (ClusterIssuer) containing key 'token' with the bearer token.
	AuthSecretRef SecretKeySelector `json:"authSecretRef"`

	// Default certificate type for requests when not derivable from usages.
	// +kubebuilder:validation:Enum=server;client;dual
	// +kubebuilder:default=dual
	// +optional
	CertificateType string `json:"certificateType,omitempty"`

	// If true, controller adds a finalizer that calls /external/revoke when a
	// CertificateRequest is deleted.
	// +kubebuilder:default=false
	// +optional
	RevokeOnDelete bool `json:"revokeOnDelete,omitempty"`
}

type SecretKeySelector struct {
	corev1.LocalObjectReference `json:",inline"`
	// Key inside the Secret. Defaults to "token".
	// +optional
	Key string `json:"key,omitempty"`
}

// IssuerStatus reports observed state.
type IssuerStatus struct {
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`
}

// IssuerCondition types.
const (
	IssuerConditionReady = "Ready"
)

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="Ready",type="string",JSONPath=".status.conditions[?(@.type=='Ready')].status"
// +kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp"
type Issuer struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   IssuerSpec   `json:"spec,omitempty"`
	Status IssuerStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
type IssuerList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Issuer `json:"items"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:scope=Cluster
// +kubebuilder:printcolumn:name="Ready",type="string",JSONPath=".status.conditions[?(@.type=='Ready')].status"
// +kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp"
type ClusterIssuer struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   IssuerSpec   `json:"spec,omitempty"`
	Status IssuerStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
type ClusterIssuerList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ClusterIssuer `json:"items"`
}

func init() {
	SchemeBuilder.Register(&Issuer{}, &IssuerList{}, &ClusterIssuer{}, &ClusterIssuerList{})
}
