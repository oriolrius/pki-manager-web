// Hand-written deepcopy methods. Replace with controller-gen output later.
package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

func (in *SecretKeySelector) DeepCopyInto(out *SecretKeySelector) {
	*out = *in
}

func (in *IssuerSpec) DeepCopyInto(out *IssuerSpec) {
	*out = *in
	if in.CABundle != nil {
		out.CABundle = make([]byte, len(in.CABundle))
		copy(out.CABundle, in.CABundle)
	}
	in.AuthSecretRef.DeepCopyInto(&out.AuthSecretRef)
}

func (in *IssuerStatus) DeepCopyInto(out *IssuerStatus) {
	*out = *in
	if in.Conditions != nil {
		out.Conditions = make([]metav1.Condition, len(in.Conditions))
		for i := range in.Conditions {
			in.Conditions[i].DeepCopyInto(&out.Conditions[i])
		}
	}
}

func (in *Issuer) DeepCopyInto(out *Issuer) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	in.Status.DeepCopyInto(&out.Status)
}
func (in *Issuer) DeepCopy() *Issuer {
	if in == nil {
		return nil
	}
	out := new(Issuer)
	in.DeepCopyInto(out)
	return out
}
func (in *Issuer) DeepCopyObject() runtime.Object { return in.DeepCopy() }

func (in *IssuerList) DeepCopyInto(out *IssuerList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		out.Items = make([]Issuer, len(in.Items))
		for i := range in.Items {
			in.Items[i].DeepCopyInto(&out.Items[i])
		}
	}
}
func (in *IssuerList) DeepCopy() *IssuerList {
	if in == nil {
		return nil
	}
	out := new(IssuerList)
	in.DeepCopyInto(out)
	return out
}
func (in *IssuerList) DeepCopyObject() runtime.Object { return in.DeepCopy() }

func (in *ClusterIssuer) DeepCopyInto(out *ClusterIssuer) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ObjectMeta.DeepCopyInto(&out.ObjectMeta)
	in.Spec.DeepCopyInto(&out.Spec)
	in.Status.DeepCopyInto(&out.Status)
}
func (in *ClusterIssuer) DeepCopy() *ClusterIssuer {
	if in == nil {
		return nil
	}
	out := new(ClusterIssuer)
	in.DeepCopyInto(out)
	return out
}
func (in *ClusterIssuer) DeepCopyObject() runtime.Object { return in.DeepCopy() }

func (in *ClusterIssuerList) DeepCopyInto(out *ClusterIssuerList) {
	*out = *in
	out.TypeMeta = in.TypeMeta
	in.ListMeta.DeepCopyInto(&out.ListMeta)
	if in.Items != nil {
		out.Items = make([]ClusterIssuer, len(in.Items))
		for i := range in.Items {
			in.Items[i].DeepCopyInto(&out.Items[i])
		}
	}
}
func (in *ClusterIssuerList) DeepCopy() *ClusterIssuerList {
	if in == nil {
		return nil
	}
	out := new(ClusterIssuerList)
	in.DeepCopyInto(out)
	return out
}
func (in *ClusterIssuerList) DeepCopyObject() runtime.Object { return in.DeepCopy() }
